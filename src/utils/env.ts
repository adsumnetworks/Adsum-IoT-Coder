import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import open from "open"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Writes text to the system clipboard
 * @param text The text to write to the clipboard
 * @returns Promise that resolves when the operation is complete
 * @throws Error if the operation fails
 */
export async function writeTextToClipboard(text: string): Promise<void> {
	try {
		await HostProvider.env.clipboardWriteText(StringRequest.create({ value: text }))
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to write to clipboard: ${errorMessage}`)
	}
}

/**
 * Reads text from the system clipboard
 * @returns Promise that resolves to the clipboard text
 * @throws Error if the operation fails
 */
export async function readTextFromClipboard(): Promise<string> {
	try {
		const response = await HostProvider.env.clipboardReadText(EmptyRequest.create({}))
		return response.value
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to read from clipboard: ${errorMessage}`)
	}
}

/**
 * Opens an external URL in the default browser
 * @param url The URL to open
 * @returns Promise that resolves when the operation is complete
 * @throws Error if the operation fails
 */
export async function openExternal(url: string): Promise<void> {
	console.log("Opening browser:", url)

	/**
	 * [BENCH 2026-09-06, I-55] Ask the EDITOR to open the link, not this process.
	 *
	 * The npm `open` package launches a browser on the machine the Node process runs on. Inside a
	 * Remote-SSH window, a codespace or a dev container, that machine is the REMOTE — so the
	 * sign-in page opened on a lab bench's own display, at a login screen nobody was sitting at,
	 * while the developer watched a button do nothing on their laptop. Twice.
	 *
	 * It fails silently, which is the worst part: the button looks inert, so the conclusion is
	 * "sign-in is broken" and the funnel ends there. For embedded work, remote windows are the
	 * normal setup rather than an edge case, so this was most of the affected population.
	 *
	 * `vscode.env.openExternal` exists for exactly this: the editor forwards the URL to wherever
	 * the human actually is. The import is dynamic and guarded because this module is also bundled
	 * into the standalone core, where `vscode` does not resolve — there, opening locally IS right,
	 * and that is what the fall-through does.
	 */
	try {
		const vscode = await import("vscode")
		if (await vscode.env.openExternal(vscode.Uri.parse(url))) {
			return
		}
		// Resolved false: the editor declined (an unhandled scheme, or the user said no). Falling
		// through would open a second browser behind their back, so stop and say so.
		throw new Error("the editor declined to open the link")
	} catch (e) {
		const why = e instanceof Error ? e.message : String(e)
		// Not running inside VS Code — the standalone core, where this process IS the local machine.
		if (/Cannot find module|Dynamic require|not defined/i.test(why)) {
			await open(url)
			return
		}
		throw new Error(`Could not open ${url}: ${why}`)
	}
}

/**
 * Opens `filePath` in a specific application (by binary path/name) rather than the OS default —
 * e.g. handing a captured `.pcap`/`.btmon` off to Wireshark. Spawns detached; resolves once launched,
 * does not wait for the app to exit.
 * @throws Error if the operation fails
 */
export async function openWithApp(filePath: string, appPath: string): Promise<void> {
	console.log("Opening in app:", appPath, filePath)
	try {
		await open(filePath, { app: { name: appPath } })
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to open ${filePath} in ${appPath}: ${errorMessage}`)
	}
}
