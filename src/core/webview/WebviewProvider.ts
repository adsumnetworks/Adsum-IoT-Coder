import path from "node:path"
import { Controller } from "@core/controller/index"
import axios from "axios"
import { readFile } from "fs/promises"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getNonce } from "./getNonce"

/** Which surface a webview hosts: the sidebar rail, or one session in an editor tab. */
export type WebviewKind = "sidebar" | "session"

export abstract class WebviewProvider {
	/**
	 * [0.5 sessions first] Every live webview, the sidebar and one panel per session tab. There used to be
	 * one static `instance`; eight callers asked for "the" webview and got whichever was built last. Now a
	 * caller says which it means: `getSidebarInstance()` for the rail, `getActiveInstance()` for the surface
	 * the developer is looking at, `getAllInstances()` to broadcast.
	 */
	private static readonly instances = new Map<string, WebviewProvider>()
	private static activeId: string | null = null
	private static seq = 0

	readonly instanceId: string
	controller: Controller

	constructor(
		readonly context: vscode.ExtensionContext,
		readonly kind: WebviewKind = "sidebar",
	) {
		this.instanceId = `${kind}-${++WebviewProvider.seq}`
		WebviewProvider.instances.set(this.instanceId, this)
		if (kind === "sidebar" || WebviewProvider.activeId === null) {
			WebviewProvider.activeId = this.instanceId
		}

		// Create controller with cache service
		this.controller = new Controller(context)
	}

	/** The developer focused this surface: it is where editor commands (add to chat, focus input) land. */
	markActive(): void {
		WebviewProvider.activeId = this.instanceId
	}

	async dispose() {
		await this.controller.dispose()
		WebviewProvider.instances.delete(this.instanceId)
		if (WebviewProvider.activeId === this.instanceId) {
			WebviewProvider.activeId = WebviewProvider.getSidebarInstance()?.instanceId ?? null
		}
	}

	/** The sidebar rail's webview. Throws before the sidebar exists, as `getInstance()` always did. */
	public static getSidebarInstance(): WebviewProvider {
		for (const w of WebviewProvider.instances.values()) {
			if (w.kind === "sidebar") {
				return w
			}
		}
		throw new Error("WebviewProvider instance not initialized. Make sure to create a WebviewProvider instance first.")
	}

	/** Kept for the callers that meant the sidebar; new code says `getSidebarInstance()`. */
	public static getInstance(): WebviewProvider {
		return WebviewProvider.getSidebarInstance()
	}

	/** The surface the developer last focused: a session tab when one has focus, else the sidebar. */
	public static getActiveInstance(): WebviewProvider | undefined {
		const active = WebviewProvider.activeId ? WebviewProvider.instances.get(WebviewProvider.activeId) : undefined
		if (active) {
			return active
		}
		try {
			return WebviewProvider.getSidebarInstance()
		} catch {
			return undefined
		}
	}

	/** The active session tab when one is open, else undefined (never the sidebar). */
	public static getActiveSession(): WebviewProvider | undefined {
		const active = WebviewProvider.getActiveInstance()
		if (active?.kind === "session") {
			return active
		}
		for (const w of WebviewProvider.instances.values()) {
			if (w.kind === "session" && w.isVisible()) {
				return w
			}
		}
		return undefined
	}

	/** A visible surface, the active one first; undefined when nothing of ours is on screen. */
	public static getVisibleInstance(): WebviewProvider | undefined {
		const active = WebviewProvider.getActiveInstance()
		if (active?.isVisible()) {
			return active
		}
		for (const w of WebviewProvider.instances.values()) {
			if (w.isVisible()) {
				return w
			}
		}
		return undefined
	}

	public static getAllInstances(): WebviewProvider[] {
		return [...WebviewProvider.instances.values()]
	}

	public static getSessionInstances(): WebviewProvider[] {
		return WebviewProvider.getAllInstances().filter((w) => w.kind === "session")
	}

	/** The session tab already showing this task, if any: a session is focused, never opened twice. */
	public static findSession(taskId: string): WebviewProvider | undefined {
		return WebviewProvider.getSessionInstances().find((w) => w.controller.task?.taskId === taskId)
	}

	public static async disposeAllInstances() {
		for (const w of [...WebviewProvider.instances.values()]) {
			await w.dispose()
		}
	}

	/**
	 * Converts a local filesystem path to a URL that can be used within the webview.
	 *
	 * @param path - The local path to convert
	 * @returns A URL that can be used within the webview
	 */
	abstract getWebviewUrl(path: string): string

	/**
	 * Gets the Content Security Policy source for the webview.
	 *
	 * @returns The CSP source string to be used in the webview's Content-Security-Policy
	 */
	abstract getCspSource(): string

	/**
	 * Checks if the webview is currently visible to the user.
	 *
	 * @returns True if the webview is visible, false otherwise
	 */
	abstract isVisible(): boolean

	/** The one line the React bundle reads before it mounts: which surface it is. */
	protected viewKindScript(nonce: string): string {
		return `<script nonce="${nonce}">window.__ADSUM_VIEW__=${JSON.stringify(this.kind)};</script>`
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the React webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	public getHtmlContent(): string {
		// Get the local path to main script run in the webview,
		// then convert it to a url we can use in the webview.
		// The JS file from the React build output
		const scriptUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.js")

		// The CSS file from the React build output. Codicons are already
		// @imported by webview-ui/src/index.css → bundled into index.css and
		// the font.ttf lives in webview-ui/build/assets/, so we don't need a
		// separate <link> to node_modules/@vscode/codicons (which `.vscodeignore`
		// excludes from the VSIX anyway — that link always 404'd).
		const stylesUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.css")

		// Use a nonce to only allow a specific script to be run.
		/*
				content security policy of your webview to only allow scripts that have a specific nonce
				create a content security policy meta tag so that only loading scripts with a nonce is allowed
				As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
								<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

				in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
				*/
		const nonce = getNonce()

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta name="theme-color" content="#000000">
				<link rel="stylesheet" type="text/css" href="${stylesUrl}">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none';
					connect-src https://*.posthog.com https://*.cline.bot;
					font-src ${this.getCspSource()} data:;
					style-src ${this.getCspSource()} 'unsafe-inline';
					img-src ${this.getCspSource()} https: data:;
					script-src 'nonce-${nonce}' 'unsafe-eval';">
				<title>Adsum IoT Coder</title>
				<style>
					@keyframes adsum-splash-spin { to { transform: rotate(360deg); } }
					#adsum-splash {
						position: fixed; inset: 0; display: flex;
						align-items: center; justify-content: center;
						background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
					}
					#adsum-splash .adsum-splash-ring {
						width: 28px; height: 28px; border-radius: 50%;
						border: 3px solid var(--vscode-progressBar-background, #0e70c0);
						border-top-color: transparent;
						animation: adsum-splash-spin 0.8s linear infinite;
					}
				</style>
			</head>
			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<!-- Splash lives inside #root so React clears it automatically on mount.
				     Gives immediate branded feedback while the bundle parses on cold
				     cache, instead of a black screen. -->
				<div id="root">
					<div id="adsum-splash"><div class="adsum-splash-ring"></div></div>
				</div>
				${this.viewKindScript(nonce)}
				<script type="module" nonce="${nonce}" src="${scriptUrl}"></script>
				${process.env.IS_DEV ? '<script src="http://localhost:8097"></script>' : ""}
			</body>
		</html>
		`
	}

	/**
	 * Reads the Vite dev server port from the generated port file to avoid conflicts
	 * Returns a Promise that resolves to the port number
	 * If the file doesn't exist or can't be read, it resolves to the default port
	 */
	private getDevServerPort(): Promise<number> {
		const DEFAULT_PORT = 25463

		const portFilePath = path.join(__dirname, "..", "webview-ui", ".vite-port")

		return readFile(portFilePath, "utf8")
			.then((portFile) => {
				const port = parseInt(portFile.trim()) || DEFAULT_PORT
				console.info(`[getDevServerPort] Using dev server port ${port} from .vite-port file`)

				return port
			})
			.catch((_err) => {
				console.warn(
					`[getDevServerPort] Port file not found or couldn't be read at ${portFilePath}, using default port: ${DEFAULT_PORT}`,
				)
				return DEFAULT_PORT
			})
	}

	/**
	 * Connects to the local Vite dev server to allow HMR, with fallback to the bundled assets
	 *
	 * @param webview A reference to the extension webview
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	protected async getHMRHtmlContent(): Promise<string> {
		const localPort = await this.getDevServerPort()
		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running. 1s timeout so a port that accepts but
		// never responds can't hang F5 activation forever — fall back to bundled assets.
		try {
			await axios.get(`http://${localServerUrl}`, { timeout: 1000 })
		} catch (_error) {
			// Only show the error message when in development mode.
			if (process.env.IS_DEV) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message:
						"Adsum IoT Coder: Local webview dev server is not running, HMR will not work. Please run 'npm run dev:webview' before launching the extension to enable HMR. Using bundled assets.",
				})
			}

			return this.getHtmlContent()
		}

		const nonce = getNonce()
		const stylesUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.css")

		const scriptEntrypoint = "src/main.tsx"
		const scriptUrl = `http://${localServerUrl}/${scriptEntrypoint}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://${localServerUrl}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			// `data:` allows the inlined base64 fonts from the production build/assets/index.css
			// (which the HMR path still links). The http origins cover fonts served directly by
			// the Vite dev server during CSS HMR. Without `data:` the codicon/azeret fonts are
			// CSP-blocked in dev, so icons render blank even though production is fine.
			`font-src ${this.getCspSource()} data: http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`style-src ${this.getCspSource()} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${this.getCspSource()} https: data:`,
			`script-src 'unsafe-eval' https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					${process.env.IS_DEV ? '<script src="http://localhost:8097"></script>' : ""}
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUrl}">
					<title>Adsum IoT Coder</title>
				</head>
				<body>
					<div id="root"></div>
					${this.viewKindScript(nonce)}
					${reactRefresh}
					<script type="module" src="${scriptUrl}"></script>
				</body>
			</html>
		`
	}
	/**
	 * A helper function which will get the webview URL of a given file or resource in the extension directory.
	 *
	 * @remarks This URL can be used within a webview's HTML as a link to the
	 * given file/resource.
	 *
	 * @param pathList An array of strings representing the path to a file/resource in the extension directory.
	 * @returns A URL pointing to the file/resource
	 */
	private getExtensionUrl(...pathList: string[]): string {
		const assetPath = path.resolve(HostProvider.get().extensionFsPath, ...pathList)
		return this.getWebviewUrl(assetPath)
	}
}
