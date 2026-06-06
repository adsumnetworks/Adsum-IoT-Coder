export interface NrfBoard {
	serialNumber: string
	deviceFamily?: string
	deviceName?: string
	deviceVersion?: string
	/** Nordic DK board number, e.g. "PCA10056" — the label developers recognize. */
	boardVersion?: string
}

export interface NrfEnvironment {
	status: "unknown" | "detecting" | "ready"
	extensionPresent: boolean
	/** Extension version — labeled as extension version, never as SDK version. */
	extensionVersion?: string
	nrfutilPresent: boolean
	/** NCS SDK versions installed on this machine, e.g. ["v3.2.1"]. Global fact, not workspace-bound. */
	installedSdkVersions?: string[]
	boards: NrfBoard[]
	lastDetectedAt?: number
}
