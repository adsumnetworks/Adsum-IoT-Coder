/**
 * Which editor the extension is running in — VS Code vs Cursor / Windsurf / VSCodium / Code-OSS.
 *
 * Why this exists: `process.platform` (already on every event) is the OS, not the editor, and the corpus had
 * NO editor signal at all — so "how many of our Open VSX installs are Cursor?" was unanswerable. VS Code's
 * `env.appName` / `env.uriScheme` carry it, but only the host can read them (this module stays vscode-free so
 * it is safe in the standalone core). The host sets the value once at activation; readers get it cached.
 *
 * Used two ways, deliberately:
 *   • as a telemetry super-property  → the editor mix of the CONSENTED population (telemetry on).
 *   • as a backend request header    → the editor mix of ALL installs, because backend calls are NOT gated by
 *     telemetry consent — the only way to see the many Open VSX / Cursor installs that run with telemetry off.
 */
export interface EditorIdentity {
	/** Human-readable, for display: "Visual Studio Code", "Cursor", "Windsurf", "VSCodium", "Code - OSS". */
	name: string
	/** Stable machine key, better for grouping: "vscode", "cursor", "windsurf", "vscodium", "vscode-insiders". */
	scheme: string
}

let _editor: EditorIdentity | undefined

/** Host-only: call once at activation with `{ name: vscode.env.appName, scheme: vscode.env.uriScheme }`. */
export function setEditorIdentity(v: EditorIdentity): void {
	_editor = v
}

/** The editor identity, or undefined before the host sets it (or in a non-editor host). */
export function getEditorIdentity(): EditorIdentity | undefined {
	return _editor
}
