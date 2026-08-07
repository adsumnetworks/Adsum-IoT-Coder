import type { DevicesJson, EnvJson, KnownDevice } from "./schema"

/**
 * Turn output the host ALREADY produces into memory records.
 *
 * There is deliberately no new detection here. The detectors run today, cache their results, and
 * then throw them away after building one prompt — which is why the agent re-ran `nrfutil device
 * list`, port enumeration and SDK version probes over and over across sessions. This module is the
 * missing "write it down" half.
 */

// ── nrfutil device list ──────────────────────────────────────────────────────────
//
// Real output from a bench with a DK and an ESP32 attached:
//
//   1
//   Product         CP2102 USB to UART Bridge Controller
//   Ports           COM10
//   Traits          serialPorts, usb
//
//   683335182
//   Product         J-Link
//   Board version   PCA10056
//   Ports           COM9
//   Traits          devkit, jlink, seggerUsb, serialPorts, usb
//
//   Found 2 supported devices
//
// The id line is bare (a serial, or a small integer for a non-Segger bridge); the fields that
// follow are two-space-padded label/value pairs. Parsing is deliberately tolerant: CRLF, blank
// lines, the trailer, and unknown fields must all be survivable, because a parse failure here
// must never break a capture.

const FIELD = /^(Product|Board version|Ports|Traits|Serial number|Family|Device version)\s{2,}(.+)$/

export function devicesFromProbe(raw: string): KnownDevice[] {
	const out: KnownDevice[] = []
	let current: (Partial<KnownDevice> & { traits?: string }) | undefined

	const flush = () => {
		if (!current?.id) {
			return
		}
		const traits = current.traits ?? ""
		const kind: KnownDevice["kind"] = traits.includes("jlink")
			? "jlink"
			: /serialPorts|usb/.test(traits) || /UART|CP210|CH340|FTDI/i.test(current.description ?? "")
				? "usb-serial"
				: "other"
		out.push({
			id: current.id,
			kind,
			description: current.description,
			board: current.board,
			family: current.family,
			port: current.port,
		})
		current = undefined
	}

	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trimEnd()
		if (!line.trim()) {
			continue
		}
		if (/^Found \d+ supported device/i.test(line.trim())) {
			continue
		}
		const m = line.match(FIELD)
		if (m && current) {
			const [, label, value] = m
			const v = value.trim()
			switch (label) {
				case "Product":
					current.description = v
					break
				case "Board version":
					current.board = v
					break
				case "Ports":
					// Multiple ports can be listed; the first is the one the tools use.
					current.port = v.split(/[,\s]+/).filter(Boolean)[0]
					break
				case "Family":
					current.family = v
					break
				case "Traits":
					current.traits = v
					break
				case "Serial number":
					current.id = v
					break
				default:
					break
			}
			continue
		}
		// A bare, unindented token starts a new device record.
		if (!/^\s/.test(rawLine) && /^[A-Za-z0-9_-]+$/.test(line.trim())) {
			flush()
			current = { id: line.trim() }
		}
	}
	flush()
	return out
}

/**
 * Fold a fresh probe into what we already knew.
 *
 * Two rules matter:
 *  - NEVER destroy developer-supplied facts (`mode`: jumpers, switch positions) or history
 *    (`lastFlashedAt`). The probe cannot see them and must not clobber them.
 *  - NEVER delete a device just because it was not seen. An unplugged DK is still this bench's DK;
 *    dropping it would make the agent re-ask for hardware it has already been told about. It is
 *    marked not-currently-present via its stale `lastSeenAt` instead.
 */
export function mergeDevices(known: DevicesJson, probed: KnownDevice[], nowIso: string): DevicesJson {
	const byId = new Map<string, KnownDevice>()
	for (const d of known.devices) {
		byId.set(d.id, { ...d })
	}
	for (const p of probed) {
		const existing = byId.get(p.id)
		if (existing) {
			byId.set(p.id, {
				...existing,
				kind: p.kind,
				description: p.description ?? existing.description,
				board: p.board ?? existing.board,
				family: p.family ?? existing.family,
				port: p.port ?? existing.port,
				// preserved, never probe-derived:
				mode: existing.mode,
				lastFlashedAt: existing.lastFlashedAt,
				lastSeenAt: nowIso,
			})
		} else {
			byId.set(p.id, { ...p, lastSeenAt: nowIso })
		}
	}
	return {
		schema: 1,
		probedAt: nowIso,
		devices: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
	}
}

/** True when a device was not seen by the most recent probe (rendered as a staleness hint). */
export function isCurrentlyPresent(device: KnownDevice, probedAt: string | undefined): boolean {
	return Boolean(probedAt && device.lastSeenAt === probedAt)
}

// ── toolchain ────────────────────────────────────────────────────────────────────

export interface NrfEnvLike {
	installedSdkVersions?: string[]
	sdkRoots?: Record<string, string>
	projectSdk?: { version?: string; source?: string }
}
export interface EspEnvLike {
	idfVersion?: string
	projectIdfVersion?: string
	idfPath?: string
}

export function envFromDetectors(nrf: NrfEnvLike | undefined, esp: EspEnvLike | undefined, nowIso: string): EnvJson {
	return {
		schema: 1,
		ncsVersions: nrf?.installedSdkVersions?.length ? [...nrf.installedSdkVersions].sort() : undefined,
		ncsProjectVersion: nrf?.projectSdk?.version,
		ncsRoots: nrf?.sdkRoots,
		idfVersion: esp?.idfVersion,
		idfProjectVersion: esp?.projectIdfVersion,
		idfPath: esp?.idfPath,
		detectedAt: nowIso,
	}
}
