export interface EspDevice {
	port: string
	vid?: number
	pid?: number
	description?: string
	/** USB serial number — stable per physical board; used to cache the resolved chip. */
	serialNumber?: string
	/** Exact chip resolved by esptool flash_id (e.g. "ESP32-S3"). Undefined until probed. */
	chip?: string
	/** Silicon revision from esptool (e.g. "v0.2"). */
	chipRevision?: string
}

/**
 * ESP-IDF environment detected for the current machine + workspace.
 * Mirrors NrfEnvironment from nrf.ts — same shape, same status lifecycle.
 */
export interface EspEnvironment {
	status: "unknown" | "detecting" | "ready"
	/** True when the Espressif ESP-IDF VS Code extension (espressif.esp-idf-extension) is installed. */
	extensionPresent: boolean
	extensionVersion?: string
	/** True when a valid IDF_PATH was resolved (export.sh found). */
	idfPresent: boolean
	idfPath?: string
	/** IDF version from {idfPath}/version.txt — machine-installed. */
	idfVersion?: string
	/** IDF version bound to the open project from build/project_description.json. */
	projectIdfVersion?: string
	/** True when the open workspace contains at least one ESP-IDF project (WorkspaceClassifier). */
	projectDetected: boolean
	/** Serial ports whose USB VID/PID match known ESP32-family bridges (passive, no reset). */
	espDevices: EspDevice[]
	lastDetectedAt?: number
}
