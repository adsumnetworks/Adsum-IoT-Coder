import { v4 as uuidv4 } from "uuid"
import { ExtensionContext } from "vscode"

const INSTALL_ID_KEY = "adsum.installId"

let _installId: string = ""

/**
 * Initializes a stable, anonymous install ID for the Adsum free-tier proxy.
 * Persisted in VS Code global state — survives restarts, not reinstalls.
 * Intentionally separate from the telemetry distinctId so the two can be
 * aliased (install_id → email-keyed id) at Stage 1 without collision.
 */
export async function initializeInstallId(context: ExtensionContext): Promise<string> {
	let id = context.globalState.get<string>(INSTALL_ID_KEY)
	if (!id) {
		id = "adsum-" + uuidv4()
		await context.globalState.update(INSTALL_ID_KEY, id)
	}
	_installId = id
	return id
}

export function getInstallId(): string {
	if (!_installId) {
		throw new Error("Adsum install ID not initialized. Call initializeInstallId() first.")
	}
	return _installId
}
