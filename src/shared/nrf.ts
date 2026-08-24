export interface NrfBoard {
	serialNumber: string
	deviceFamily?: string
	deviceName?: string
	deviceVersion?: string
	/** Nordic DK board number, e.g. "PCA10056" — the label developers recognize. */
	boardVersion?: string
	/**
	 * The board name for `boardVersion`, resolved HOST-side from the `board-identity` bit.
	 *
	 * The mapping used to be a constant in the webview, which meant a board Nordic shipped after our
	 * last release showed as a bare PCA number until someone cut a VSIX — and one release did exactly
	 * that. Resolving it here lets the registry correct the table instead. Absent when the table does
	 * not know this PCA, and the UI then shows the raw number, as it always did.
	 */
	boardName?: string
	/**
	 * The USB product string, e.g. "Seeed Studio XIAO nRF54LM20A CMSIS-DAP".
	 *
	 * For a Nordic DK this is redundant with `boardVersion`. For a THIRD-PARTY module it is the only
	 * identity there is: a XIAO carries an on-board CMSIS-DAP rather than a SEGGER J-Link, so
	 * `nrfutil device list` reports no `devkit` and no `jlink` object for it, and every Nordic-identity
	 * field is empty. The product string still names the chip, and it is what distinguishes a XIAO
	 * from the DK carrying the same silicon — which is a different board target with different pins.
	 */
	productName?: string
	/** USB vendor name, e.g. "Seeed Studio". Present for third-party modules. */
	usbManufacturer?: string
	/**
	 * nrfutil classified this as a Nordic USB device — its `nordicUsb` trait.
	 *
	 * The nRF52840 Dongle running sniffer firmware has NO devkit and NO jlink object: it publishes
	 * `nordicUsb` and the product string "nRF Sniffer for Bluetooth LE", and names no chip. Every
	 * Nordic-identity field is therefore empty and the board filter dropped it — so the one device the
	 * over-the-air layer of a BLE debug needs was the one the strip would not admit was plugged in.
	 * nrfutil has already decided this is a Nordic device; take its word rather than re-deriving.
	 */
	nordicUsb?: boolean
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
	/**
	 * All DISTINCT NCS versions across the project's build dirs, set only when they DISAGREE (>1) —
	 * e.g. build/ on NCS 3.2.1 and build_1/ on 3.3.1. We can't read which build the nRF Connect
	 * extension has *selected* (it lives in the extension's memento, not a file), so rather than guess
	 * a single value we surface all of them. Drives the "multiple builds" strip label.
	 */
	allVersions?: string[]
	/** Per-build-dir version (for the tooltip), present alongside `allVersions`. */
	builds?: { dir: string; version: string }[]
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
