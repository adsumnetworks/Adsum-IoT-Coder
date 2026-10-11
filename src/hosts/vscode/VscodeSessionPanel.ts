import { sendShowWebviewEvent } from "@core/controller/ui/subscribeToShowWebview"
import { WebviewProvider } from "@core/webview"
import * as vscode from "vscode"
import { handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { sendAddToInputEvent } from "@/core/controller/ui/subscribeToAddToInput"
import { HostProvider } from "@/hosts/host-provider"
import { type ContinueRoute, continueRoute } from "@/services/hardware/HardwarePortGuard"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import type { HistoryItem } from "@/shared/HistoryItem"
import { WebviewMessage } from "@/shared/WebviewMessage"
import { SESSION_PANEL_TYPE } from "./besideSessionColumn"
import { deliverToWebview } from "./deliverToWebview"
import { openSessions, sessionsChanged } from "./sessionRegistry"

/** Set at deactivation so tabs VS Code tears down do not each offer to reopen. */
let hostShuttingDown = false
export function markHostShuttingDown(): void {
	hostShuttingDown = true
}

/** The webview panel type VS Code uses to find the serializer after a reload. */
export { SESSION_PANEL_TYPE }

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
	/** The title the opener gave (a Hardware page button, a card): shown until the session has a name, then its name. */
	private givenTitle?: string
	/** What the rail last heard of this tab (title, waiting, working), so a save repaints it only on a change. */
	private lastMark = ""

	private constructor(context: vscode.ExtensionContext) {
		super(context, "session")
	}

	/** Opens (or focuses) the tab for a session, and starts or prefills it as asked. */
	public static async open(context: vscode.ExtensionContext, opts: OpenSessionOptions = {}): Promise<VscodeSessionPanel> {
		if (opts.taskId) {
			const existing = WebviewProvider.findSession(opts.taskId)
			// A tab that is closing has no panel left to show: reveal() on it did nothing, and the row "opened nothing".
			if (existing instanceof VscodeSessionPanel && existing.panel) {
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
		session.givenTitle = opts.title?.trim() || undefined
		await session.attach(panel)
		if (opts.taskId) {
			await session.showTask(opts.taskId)
			session.refreshTitle()
		} else if (opts.prompt && opts.send) {
			// The session's history row is written by its first message, after this returns: the tab keeps the
			// opener's title meanwhile, and `historySaved` names it for good.
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
		// The tab's mark in the brand coral on both themes: a currentColor SVG renders black in a tab, which
		// vanishes on a dark theme.
		const coral = vscode.Uri.file(
			require("node:path").join(HostProvider.get().extensionFsPath, "assets", "icons", "icon-coral.svg"),
		)
		panel.iconPath = { light: coral, dark: coral }
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

	/**
	 * The tab reads the session's own name, else the title its opener gave, else its first words; "New session"
	 * until it has any of them. Called on open, on restore, and on every save of the session's history row
	 * (`historySaved`), which is what names a tab whose first message was typed in it.
	 */
	refreshTitle(saved?: HistoryItem): void {
		if (!this.panel) {
			return
		}
		const task = this.controller.task
		const history = this.controller.stateManager.getGlobalStateKey("taskHistory") || []
		const item = saved ?? (task ? history.find((h) => h.id === task.taskId) : undefined)
		const title = (item?.title || this.givenTitle || item?.task || "").trim()
		const shown = title ? (title.length > 48 ? `${title.slice(0, 47)}…` : title) : "New session"
		if (this.panel.title !== shown) {
			this.panel.title = shown
		}
		const messages = task?.messageStateHandler.getClineMessages() ?? []
		const last = messages[messages.length - 1]
		const mark = `${shown}|${!!last && last.type === "ask" && !last.partial}|${!!task?.taskState.isStreaming}`
		if (mark !== this.lastMark) {
			this.lastMark = mark
			sessionsChanged()
		}
	}

	/**
	 * A save of this tab's session. The first one gives the row the opener's short title ("Logs · LBG20x AD50"), so
	 * the rail does not list a button's session by its two-hundred-word prompt; a name the developer gave is kept.
	 */
	historySaved(item: HistoryItem): void {
		if (this.givenTitle && !item.title) {
			const title = this.givenTitle
			this.givenTitle = undefined
			const history = this.controller.stateManager.getGlobalStateKey("taskHistory") || []
			const idx = history.findIndex((h) => h.id === item.id)
			if (idx !== -1) {
				const updated = [...history]
				updated[idx] = { ...updated[idx], title }
				this.controller.stateManager.setGlobalState("taskHistory", updated)
				item = updated[idx]
			}
		}
		this.refreshTitle(item)
	}

	/**
	 * A request for the unit this session already works with (a Hardware page button) continues here instead of
	 * opening one more tab. Returns how it was delivered, or undefined when this tab has no live task to take it.
	 */
	async continueWith(prompt: string): Promise<ContinueRoute | undefined> {
		const task = this.controller.task
		if (!this.panel || !task || task.taskState.abort) {
			return undefined
		}
		this.reveal()
		const messages = task.messageStateHandler.getClineMessages()
		const route = continueRoute(messages[messages.length - 1], !!task.taskState.isStreaming)
		if (route === "answer") {
			await task.handleWebviewAskResponse("messageResponse", prompt)
		} else if (route === "queue") {
			const queued = await task.queueUserMessage(prompt)
			if (!queued.accepted) {
				void vscode.window.showInformationMessage(
					"That session is busy and its queue is full. Wait for it, then press the button again.",
				)
			}
		} else {
			void vscode.window.showInformationMessage(
				"That session is waiting on your yes or no. Answer it there, then press the button again.",
			)
		}
		return route
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
