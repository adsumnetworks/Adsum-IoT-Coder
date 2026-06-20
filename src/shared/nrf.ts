export interface NrfBoard {
	serialNumber: string
	deviceFamily?: string
	deviceName?: string
	deviceVersion?: string
	/** Nordic DK board number, e.g. "PCA10056" — the label developers recognize. */
	boardVersion?: string
}

/**
 * The NCS SDK version bound to the currently open project.
 * - source "build": read from a build artifact (ncs_version.h) — what was actually compiled.
 * - source "manifest": read from the west workspace manifest pin (<topdir>/<manifest>/VERSION).
 * topology distinguishes a west-workspace app from a freestanding (out-of-tree) app.
 */
export interface ProjectSdk {
	version: string
	source: "build" | "manifest"
	topology: "workspace" | "freestanding" | "unknown"
}

export interface NrfEnvironment {
	status: "unknown" | "detecting" | "ready"
	extensionPresent: boolean
	/** Extension version — labeled as extension version, never as SDK version. */
	extensionVersion?: string
	nrfutilPresent: boolean
	/** NCS SDK versions installed on this machine, e.g. ["v3.2.1"]. Global fact, not workspace-bound. */
	installedSdkVersions?: string[]
	/**
	 * Normalized version (no leading "v", e.g. "3.2.1") → NCS SDK root install dir
	 * (e.g. "/home/user/ncs/v3.2.1"). Lets callers derive `ZEPHYR_BASE` for a resolved
	 * version without another nrfutil call.
	 */
	installedSdkPaths?: Record<string, string>
	/** SDK version bound to the open project, when one can be resolved. Drives "we understand this project". */
	projectSdk?: ProjectSdk
	boards: NrfBoard[]
	lastDetectedAt?: number
}
