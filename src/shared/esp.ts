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
	/** Chip base MAC (e.g. "ac:eb:e6:0c:f8:c0"), when known — read by esptool over the bridge, or taken from a
	 *  native-USB device's serial number (which IS the base MAC). Used to fold a board's two USB interfaces into one. */
	mac?: string
	/** USB location, e.g. "1-14.1.2:1.0" — two interfaces of one board sit behind the same parent hub. */
	location?: string
}

/** The parent hub of a USB location: "1-14.1.2:1.0" → "1-14.1". Undefined when there is no parent. */
export function usbParent(location: string | undefined): string | undefined {
	const dev = location?.split(":")[0]
	if (!dev || !dev.includes(".")) {
		return undefined
	}
	return dev.slice(0, dev.lastIndexOf("."))
}

/**
 * Which unresolved devices are most likely the UART bridge of a board already listed.
 *
 * A single DevKit can present two USB serial interfaces from one cable — the chip's native
 * USB-Serial/JTAG (Espressif VID 0x303a) and an on-board bridge (CP210x/CH34x) — through an internal
 * hub, so the two share a USB parent. When the bridge's chip cannot be probed (the bench's C6 reports
 * SECURE DOWNLOAD MODE, which blocks `read-mac`), `dedupeEspDevicesByMac` has no MAC to fold on and the
 * board appears twice: once resolved, once as a nameless mystery.
 *
 * This does NOT hide it. Hiding is what a merge would do, and a merge here is unsafe: two ESP boards in
 * one desk hub also share a parent, and losing a real board is worse than showing an extra row. It only
 * says what the extra row probably is, so the reader is not left counting phantom boards.
 */
export function looksLikeSiblingBridge(d: EspDevice, all: EspDevice[]): boolean {
	if (d.chip) {
		return false // already identified — nothing to explain
	}
	const parent = usbParent(d.location)
	if (!parent) {
		return false
	}
	// Any RESOLVED sibling behind the same hub, whatever VID this one carries. The first cut required the
	// unresolved device to be a generic bridge and its sibling to be Espressif-native, which is the bench's
	// C6 (native 0x303a + CH343 0x1a86 behind an on-board hub). It is not the only shape: a board can also
	// present two interfaces on its OWN vendor id, and the one that fails to probe then reads as a second
	// Espressif device — "ESP (model unknown)" — which is exactly what a developer reported seeing.
	return all.some((o) => o !== d && Boolean(o.chip) && usbParent(o.location) === parent)
}

/** A USB serial number that is a 6-octet MAC ("AC:EB:E6:0C:F8:C0") — the form an ESP native-USB port exposes. */
export function isMacShaped(s: string | undefined): boolean {
	return !!s && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(s.trim())
}

/** Lower-case hex-only form of a MAC for comparison ("AC:EB:.." → "acebe60cf8c0"); undefined if not 6 octets. */
function macKey(m: string | undefined): string | undefined {
	if (!m) {
		return undefined
	}
	const hex = m.replace(/[^0-9a-f]/gi, "").toLowerCase()
	return hex.length === 12 ? hex : undefined
}

/**
 * Collapse the two USB serial interfaces of the SAME physical board into one entry.
 *
 * A single ESP DevKit can present TWO USB serial devices from one cable — its on-board UART bridge
 * (CP210x/CH34x) AND the chip's native USB-Serial/JTAG (VID 0x303a) — via an on-board hub. They share the chip's
 * base MAC: the native interface exposes it as its USB serial number, and esptool reads the same base MAC over
 * the bridge. Group by that MAC and keep the most-informative entry (a device with a resolved `chip` beats an
 * unresolved one), so one board never shows twice — and never as a phantom "ESP (model unknown)" beside its
 * resolved self.
 *
 * Purely additive + order-independent: a device with NO known MAC is passed through untouched (we never hide a
 * device we can't PROVE is a duplicate), so the common single-interface case (the Windows/Linux norm) is a no-op.
 */
export function dedupeEspDevicesByMac(devices: EspDevice[]): EspDevice[] {
	const out: EspDevice[] = []
	const idxByMac = new Map<string, number>()
	for (const d of devices) {
		// An identical USB SERIAL NUMBER is the same physical USB device presenting two interfaces — the
		// case macOS shows most often, where one board yields two ports and only one of them probes. That
		// is not an inference from topology, it is the device saying so, so it folds like a MAC match.
		const bySerial = d.serialNumber?.trim()
			? out.findIndex((o) => o.serialNumber?.trim() && o.serialNumber.trim() === d.serialNumber!.trim())
			: -1
		if (bySerial >= 0) {
			if (!out[bySerial].chip && d.chip) {
				out[bySerial] = d
			}
			continue
		}
		const key = macKey(d.mac)
		if (!key) {
			out.push(d) // no MAC → can't prove it's a duplicate → keep it
			continue
		}
		const existing = idxByMac.get(key)
		if (existing === undefined) {
			idxByMac.set(key, out.length)
			out.push(d)
			continue
		}
		// Same physical board already present — keep whichever has the resolved chip.
		if (!out[existing].chip && d.chip) {
			out[existing] = d
		}
	}
	return out
}

/**
 * Espressif's own USB VID — the integrated USB-Serial/JTAG on ESP32-S2/S3/C3/C6/H2. This VID appears ONLY on
 * real Espressif silicon, so a device presenting it IS an ESP even before esptool reads the exact model.
 *
 * The other VIDs we allow through the port filter (CP210x 0x10c4, CH34x 0x1a86, FTDI 0x0403) are GENERIC
 * USB-serial bridges used by countless non-ESP boards too — so a device on one of those is only a CONFIRMED
 * ESP once esptool reads its chip id. See {@link espUnresolvedDeviceLabel}.
 */
export const ESP_NATIVE_USB_VID = 0x303a

/**
 * Honest label for a detected serial device whose exact chip esptool could NOT resolve (port busy, probe
 * timeout, or no IDF python). We must not claim "ESP32-family" off a generic bridge VID we never confirmed:
 *   - Espressif's own VID (0x303a) → it IS an ESP, model just unknown → "ESP (model unknown)".
 *   - any generic bridge VID → we have no proof it's an ESP at all → "unidentified serial device".
 * Once esptool resolves the chip, the exact model is shown instead and this is never used.
 */
export function espUnresolvedDeviceLabel(vid: number | undefined): string {
	return vid === ESP_NATIVE_USB_VID ? "ESP (model unknown)" : "unidentified serial device"
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
	/** IDF version of the active install ({idfPath}/version.txt or version.cmake) — machine-installed. */
	idfVersion?: string
	/** ALL ESP-IDF versions installed on this machine (normalized, e.g. ["5.5.2","6.0"]). Mirrors nRF's
	 * installedSdkVersions so the strip can list every install, not just the first. Global fact. */
	installedVersions?: string[]
	/** True when the open project has a build (any build-dir/project_description.json exists). */
	projectBuilt?: boolean
	/** IDF version bound to the open project from <buildDir>/project_description.json. */
	projectIdfVersion?: string
	/** True when the open workspace contains at least one ESP-IDF project (WorkspaceClassifier). */
	projectDetected: boolean
	/** Serial ports whose USB VID/PID match known ESP32-family bridges (passive, no reset). */
	espDevices: EspDevice[]
	lastDetectedAt?: number
}
