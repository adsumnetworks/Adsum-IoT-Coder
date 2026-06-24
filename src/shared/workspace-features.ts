/**
 * Lightweight capability / file-presence signals for the open workspace, used to ground welcome-screen
 * nudges (A3 CRA nudge, A10 deep-debug sub-line). Single source of truth for the wire shape, shared by the
 * host probe (WorkspaceClassifier), the ExtensionMessage contract, and the webview state.
 *
 * MOAT INVARIANT: these flags are filesystem observations only — NOT a conformity verdict and NOT model
 * content. They MUST flow host → webview state → UI copy and MUST NOT be read by any system-prompt /
 * iot_context / model-content path. The honesty net lives in the bits + CI + the UI consumer, never the host.
 */
export interface WorkspaceFeatures {
	/** A BLE/Bluetooth stack is enabled in config (nRF `CONFIG_BT=y` or ESP `CONFIG_BT_ENABLED=y`). */
	hasBle: boolean
	/** A `compliance/` directory exists in a scanned folder (SBOM / CRA artifacts already generated). */
	hasComplianceArtifacts: boolean
}
