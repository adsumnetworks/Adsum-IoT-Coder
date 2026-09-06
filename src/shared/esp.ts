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
	/** esptool's own words when the probe failed. The ONLY thing that can say WHY a device stayed
	 *  unresolved; it used to be discarded, which is why the strip could say nothing but "unidentified". */
	probeError?: string
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
export function espUnresolvedDeviceLabel(vid: number | undefined, pid?: number): string {
	if (vid === ESP_NATIVE_USB_VID) {
		return "ESP (model unknown)"
	}
	const bridge = describeSerialBridge(vid, pid)
	return bridge ? `${bridge} · chip unconfirmed` : "unidentified serial device"
}

/**
 * The USB-serial bridge chip, named from its VID/PID — or undefined when we do not recognise it.
 *
 * This names the CABLE, never the board. Measured on the operator's own LEW840x with the Fanstel
 * `IOT-UART-ESP32-V1` bridge card attached, 6 Sep:
 *
 *     idVendor 0x10C4  idProduct 0xEA60  "CP2102 USB to UART Bridge Controller"  serial "0001"
 *
 * Those are Silicon Labs' stock identifiers, shipped unprogrammed on thousands of unrelated boards,
 * and "0001" is the default serial. There is nothing Fanstel-specific in the descriptors at all — so
 * the plan's assumption that the bridge board is "nameable from USB alone" is simply false, and no
 * row here claims a product name. Saying "CP2102 USB-UART bridge" is the most this evidence supports;
 * saying "Fanstel IOT-UART-ESP32-V1" would be a guess dressed as a fact on every CP2102 on earth.
 */
export function describeSerialBridge(vid: number | undefined, pid?: number): string | undefined {
	switch (vid) {
		case 0x10c4:
			return pid === 0xea60 ? "CP2102 USB-UART bridge" : "CP210x USB-UART bridge"
		case 0x1a86:
			if (pid === 0x7523) return "CH340 USB-UART bridge"
			if (pid === 0x55d3 || pid === 0x55d4) return "CH9102 USB-UART bridge"
			return "CH34x USB-UART bridge"
		case 0x0403:
			return "FTDI USB-UART bridge"
		default:
			return undefined
	}
}

/**
 * What esptool's failure MEANS, keyed on its own words.
 *
 * The kinds are symptoms, not causes, and that is deliberate. "No serial data received" has three
 * known causes on this hardware and the string cannot tell them apart — picking one would be the
 * confident-and-wrong answer the strip exists to avoid. The symptom is what we know; the causes are
 * listed, in the order the bench found them.
 */
export type EspProbeFailure = "no-serial-data" | "port-busy" | "wrong-boot-mode" | "timeout" | "unknown"

export function classifyEspProbeFailure(stderr: string | undefined): EspProbeFailure {
	const t = (stderr ?? "").toLowerCase()
	if (!t.trim()) {
		return "unknown"
	}
	// esptool v5 says "Espressif device", v4 said "ESP32" — both are the same failure, and a pin on
	// either wording alone would go quiet the next time the tool is upgraded.
	if (t.includes("no serial data received")) {
		return "no-serial-data"
	}
	if (/could not open|access is denied|resource busy|permission denied|device or resource busy/.test(t)) {
		return "port-busy"
	}
	if (t.includes("wrong boot mode")) {
		return "wrong-boot-mode"
	}
	if (/timed out|timeout/.test(t)) {
		return "timeout"
	}
	return "unknown"
}

/** One cause and the thing to do about it. */
export interface EspProbeCause {
	what: string
	fix: string
}

/**
 * What to tell the developer, in the order the bench actually found these.
 *
 * Every line is from `products/fanstel/lew840x/uart-bridge-board.md`, which is bench-verified on real
 * hardware. Note what is NOT here: the words "BOOT button". This board has a mode SWITCH and a
 * separate three-position selector; telling someone to hold a button they do not have is how an
 * honest-looking hint wastes an afternoon. There is a copy lint for exactly that.
 */
export function espProbeAdvice(kind: EspProbeFailure): { headline: string; causes: EspProbeCause[] } | undefined {
	switch (kind) {
		case "no-serial-data":
			return {
				headline: "The port opened, but the chip never answered. Three things do this, in this order:",
				causes: [
					{
						what: "The bridge board's selector is not on TO WIFI (ESP).",
						fix: "Only that position wires DTR and RTS through to EN and IO0. In TO LOG or TO BLE no probe can ever connect, however long it retries.",
					},
					{
						what: "The mode switch is set to run, not flash.",
						fix: "The strap is only sampled at reset — set the switch first, then press RESET. A chip that is silent is usually in flash mode, not broken.",
					},
					{
						what: "A running nRF52840 is driving the ESP's GPIO2.",
						fix: "GPIO2 is a download-boot strap; the nRF holds it and blocks the bootloader even with the switch set correctly. Silence the nRF first.",
					},
				],
			}
		case "port-busy":
			return {
				headline: "Something else is holding the port.",
				causes: [
					{
						what: "A monitor, terminal or another editor has it open.",
						fix: "Close the other reader and try again — two programs cannot share one serial port.",
					},
				],
			}
		case "wrong-boot-mode":
			return {
				headline: "The chip answered, but it is not in the bootloader.",
				causes: [
					{
						what: "The mode switch is set to run.",
						fix: "Set the switch to flash, then press RESET — the strap is only read at reset.",
					},
				],
			}
		case "timeout":
			return {
				headline: "The chip started to answer and stopped.",
				causes: [
					{
						what: "An unreliable cable or an underpowered hub.",
						fix: "Try a different cable and a port on the machine rather than through a hub.",
					},
				],
			}
		default:
			return undefined
	}
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
