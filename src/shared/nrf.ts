export interface NrfBoard {
	serialNumber: string
	deviceFamily?: string
	deviceName?: string
	deviceVersion?: string
}

export interface NrfEnvironment {
	status: "unknown" | "detecting" | "ready"
	extensionPresent: boolean
	/** Extension version — labeled as extension version, never as SDK version. */
	extensionVersion?: string
	nrfutilPresent: boolean
	boards: NrfBoard[]
	lastDetectedAt?: number
}
