import { sendShowWebviewEvent } from "@core/controller/ui/subscribeToShowWebview"
import { WebviewProvider } from "@core/webview"
import * as vscode from "vscode"
import { handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { sendAddToInputEvent } from "@/core/controller/ui/subscribeToAddToInput"
import { HostProvider } from "@/hosts/host-provider"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import { WebviewMessage } from "@/shared/WebviewMessage"
import { deliverToWebview } from "./deliverToWebview"
import { openSessions, sessionsChanged } from "./sessionRegistry"

/** Set at deactivation so tabs VS Code tears down do not each offer to reopen. */
let hostShuttingDown = false
export function markHostShuttingDown(): void {
	hostShuttingDown = true
}

/** The webview panel type VS Code uses to find the serializer after a reload. */
export const SESSION_PANEL_TYPE = "adsum-iot-coder.session"

/** What a webview stores for the serializer (`vscode.setState` on the webview side). */
export interface SessionPanelState {
	taskId?: string
}

export interface OpenSessionOptions {
	/** Show an existing session; when it already has a tab, that tab is focused, never a second one. */
	taskId?: string
	/** Text for the new session: sent as its first message when `send`, else placed in the composer. */
	prompt?: string
	send?: boolean
	/** The tab title before the session has one of its own. */
	title?: string
	/** Keep the editor focus where it is (a card click wants the tab focused; "add to chat" does not). */
	preserveFocus?: boolean
}

/**
 * [0.5 sessions first] One session, one editor tab. The sidebar is the rail alone; every session the
 * developer opens lives here, with its own controller and its own task, the way a file has its own editor.
 *
 * Several tabs may be open. A session that already has a tab is focused, never opened twice. Closing a tab
 * disposes its controller (a running task is aborted the way the sidebar's used to be on "+"), the
 * transcript stays in history, and the rail's row says the session is no longer open.
 */
export class VscodeSessionPanel extends WebviewProvider {
	private panel?: vscode.WebviewPanel
	private disposables: vscode.Disposable[] = []
	private disposed = false

	private constructor(context: vscode.ExtensionContext) {
		super(context, "session")
	}

	/** Opens (or focuses) the tab for a session, and starts or prefills it as asked. */
	public static async open(context: vscode.ExtensionContext, opts: OpenSessionOptions = {}): Promise<VscodeSessionPanel> {
		if (opts.taskId) {
			const existing = WebviewProvider.findSession(opts.taskId)
			if (existing instanceof VscodeSessionPanel) {
				existing.reveal(opts.preserveFocus)
				return existing
			}
		}
		const panel = vscode.window.createWebviewPanel(
			SESSION_PANEL_TYPE,
			opts.title ?? "New session",
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: !!opts.preserveFocus },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
			},
		)
		const session = new VscodeSessionPanel(context)
		await session.attach(panel)
		if (opts.taskId) {
			await session.showTask(opts.taskId)
			session.refreshTitle()
		} else if (opts.prompt && opts.send) {
			await session.controller.initTask(opts.prompt)
			session.refreshTitle()
		} else if (opts.prompt) {
			await sendAddToInputEvent(opts.prompt, session.controller)
		}
		return session
	}

	/** VS Code hands back a panel it restored after a reload; we put its session in it. */
	public static async revive(
		context: vscode.ExtensionContext,
		panel: vscode.WebviewPanel,
		state: SessionPanelState | undefined,
	): Promise<VscodeSessionPanel> {
		const session = new VscodeSessionPanel(context)
		await session.attach(panel)
		if (state?.taskId) {
			try {
				await session.showTask(state.taskId)
				session.refreshTitle()
			} catch (e) {
				HostProvider.get().logToChannel(
					`Session tab could not restore ${state.taskId}: ${e instanceof Error ? e.message : String(e)}`,
				)
			}
		}
		return session
	}

	private async attach(panel: vscode.WebviewPanel): Promise<void> {
		this.panel = panel
		panel.iconPath = vscode.Uri.file(
			require("node:path").join(HostProvider.get().extensionFsPath, "assets", "icons", "icon.svg"),
		)
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		}
		panel.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent()
				: this.getHtmlContent()

		panel.webview.onDidReceiveMessage((message) => void this.handleWebviewMessage(message), null, this.disposables)
		panel.onDidChangeViewState(
			async (e) => {
				if (e.webviewPanel.active) {
					this.markActive()
					await sendShowWebviewEvent(true)
				}
				sessionsChanged()
			},
			null,
			this.disposables,
		)
		panel.onDidDispose(() => void this.dispose(), null, this.disposables)
		this.markActive()
		sessionsChanged()
		HostProvider.get().logToChannel("Session tab opened")
	}

	/** Shows a session from history in this tab (the sidebar's old "show task with id", per tab). */
	async showTask(taskId: string): Promise<void> {
		const history = this.controller.stateManager.getGlobalStateKey("taskHistory") || []
		const item = history.find((h) => h.id === taskId) ?? (await this.controller.getTaskWithId(taskId)).historyItem
		await this.controller.initTask(undefined, undefined, undefined, item)
	}

	reveal(preserveFocus = false): void {
		this.panel?.reveal(undefined, preserveFocus)
		this.markActive()
	}

	/** The tab reads the session's own title once it has one; "New session" until then. */
	refreshTitle(): void {
		if (!this.panel) {
			return
		}
		const task = this.controller.task
		const history = this.controller.stateManager.getGlobalStateKey("taskHistory") || []
		const item = task ? history.find((h) => h.id === task.taskId) : undefined
		const title = (item?.title || item?.task || "").trim()
		this.panel.title = title ? (title.length > 48 ? `${title.slice(0, 47)}…` : title) : "New session"
		sessionsChanged()
	}

	/** The task this tab holds, for the rail and the status bar. */
	get taskId(): string | undefined {
		return this.controller.task?.taskId
	}

	override getWebviewUrl(path: string) {
		if (!this.panel) {
			throw new Error("Session panel not initialized")
		}
		return this.panel.webview.asWebviewUri(vscode.Uri.file(path)).toString()
	}

	override getCspSource() {
		if (!this.panel) {
			throw new Error("Session panel not initialized")
		}
		return this.panel.webview.cspSource
	}

	override isVisible() {
		return this.panel?.visible || false
	}

	get isActive(): boolean {
		return this.panel?.active || false
	}

	async handleWebviewMessage(message: WebviewMessage) {
		const postMessageToWebview = (response: ExtensionMessage) => this.postMessageToWebview(response)
		switch (message.type) {
			case "grpc_request": {
				if (message.grpc_request) {
					await handleGrpcRequest(this.controller, postMessageToWebview, message.grpc_request)
				}
				break
			}
			case "grpc_request_cancel": {
				if (message.grpc_request_cancel) {
					await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
				}
				break
			}
			default: {
				console.error("Received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
	}

	private async postMessageToWebview(message: ExtensionMessage): Promise<boolean | undefined> {
		return deliverToWebview(this.panel?.webview, message, (e) =>
			console.warn("[session tab] message not delivered:", e instanceof Error ? e.message : String(e)),
		)
	}

	override async dispose() {
		if (this.disposed) {
			return
		}
		this.disposed = true
		while (this.disposables.length) {
			this.disposables.pop()?.dispose()
		}
		const panel = this.panel
		this.panel = undefined
		// What this tab was doing, read before the controller goes: VS Code gives no "about to close" for a
		// webview panel, so the honest shape is to say what stopped and offer the way back.
		const summary = openSessions().find((s) => s.taskId === this.controller.task?.taskId)
		try {
			panel?.dispose()
		} catch {
			// already disposed by VS Code
		}
		await super.dispose()
		sessionsChanged()
		HostProvider.get().logToChannel("Session tab closed")
		if (summary && !hostShuttingDown && (summary.waiting || summary.streaming)) {
			void this.offerReopen(summary)
		}
	}

	/** A closed tab that was mid-work or waiting on an answer: one line, one way back, never a modal. */
	private async offerReopen(summary: { taskId: string; title: string; waiting: boolean }): Promise<void> {
		const name = summary.title || "A session"
		const text = summary.waiting
			? `${name} was waiting on your answer when its tab closed.`
			: `${name} was working when its tab closed; the work stopped where it was.`
		const choice = await vscode.window.showInformationMessage(text, "Reopen")
		if (choice === "Reopen") {
			await VscodeSessionPanel.open(this.context, { taskId: summary.taskId })
		}
	}
}
