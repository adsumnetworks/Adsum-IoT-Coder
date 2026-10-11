/**
 * Recognising a connected Fanstel BLG20x gateway. Pure, so the extension and the webview read one rule.
 *
 * A BLG20x shows up on a computer in one of two ways, and neither says "BLG20" through the paths the
 * nRF and ESP detectors already watch:
 *
 *  - ITS OWN USB-C SERVICE PORT. The BLE half (nRF54LM20B) owns USB and enumerates as a CDC ACM device,
 *    VID 0x1209 / PID 0x0001, product "BLG20 Gateway" (the blg20-service tool's own constants). Interface
 *    0 is the service port; interface 2 is the LTE tunnel, which exists only while the service port is
 *    unlocked, so a unit may show one port or two. Both share the unit's USB serial number.
 *    0x1209:0x0001 is pid.codes' shared test pair, so the ids alone are not unique: a port whose product
 *    string is present and does not say BLG20 is not one, and a port with NO product string (Windows
 *    often reports none) is only "possibly a BLG20" until something names it: nrfutil, which reads the
 *    USB product itself, or the service tool's passport (demo-1 plan, decision 2: the product-string
 *    check is mandatory on every OS until the unit has a PID of its own).
 *
 *    nrfutil lists the same port too (product "BLG20 Gateway", its serial ports in interface order), and
 *    every nRF developer has nrfutil, while pyserial is only certain where ESP-IDF is installed. So both
 *    listings feed the same rule and are merged by the unit's serial number.
 *
 *  - ITS BLUETOOTH SERVICE PORT (the LBG20x, whose USB-C carries power only; firmware 0.3.6+ on either
 *    gateway). The service tool's `list --ble --json` reads the advertised name, "Adsum LBG20x D3588E7AAD50":
 *    the family word, then the unit's address, whose last four digits are the same name the USB product string
 *    carries. A unit advertises only inside its commissioning window, so "seen" also means "window open".
 *    The host runs the scan (services/blg20/bleGateways.ts); this rule only turns its rows into units.
 *
 *  - TWO DEBUG PROBES, one on each chip. On the bench the board is reached through two kits, and
 *    `nrfutil device device-info` names the TARGET behind each: an nRF54LM20B and an nRF9151. The
 *    nRF54LM20 DK carries A silicon and the XIAO too, so the B part together with an nRF9151 is the
 *    BLG20's own pair. Still an inference, and a bench with an nRF54LM20 DK and an nRF9151 DK can look
 *    the same, so a probe pair alone is "possibly a BLG20": never claimed by a card, and the agent is
 *    told to confirm before treating it as one (red-team finding 7).
 *
 * Enumeration only. Opening the service port with DTR up starts a session on the unit, so nothing here
 * ever opens a port.
 */

export const BLG20_USB_VID = 0x1209
export const BLG20_USB_PID = 0x0001
export const BLG20_USB_PRODUCT = "BLG20 Gateway"

/** One serial port as pyserial lists it (the ESP detector's enumeration, which also feeds this). */
export interface Blg20RawPort {
	device: string
	vid?: number | null
	pid?: number | null
	description?: string | null
	serial_number?: string | null
	/** Linux/macOS USB location, e.g. "1-2:1.0" — the suffix after the colon is the interface. */
	location?: string | null
	product?: string | null
	manufacturer?: string | null
	/** Windows hardware id, e.g. "USB VID:PID=1209:0001 SER=... LOCATION=1-2:x.0" or "USB\\VID_1209&PID_0001&MI_00\\...". */
	hwid?: string | null
}

/** One device from `nrfutil device list --json` whose USB product names a BLG20 (the nRF detector keeps these). */
export interface Blg20NrfutilDevice {
	serialNumber: string
	product?: string
	/** Its serial ports. interfaceNumber is the USB interface (0 = service port, 2 = LTE tunnel); vcom is
	 *  nrfutil's own order (0, 1), used only when the interface is missing. */
	ports: { path: string; interfaceNumber?: number; vcom?: number }[]
}

/** The subset of an nRF board the probe rule reads (NrfBoard satisfies it). */
export interface Blg20ProbeBoard {
	serialNumber: string
	deviceName?: string
	deviceVersion?: string
	deviceFamily?: string
}

/** The gateway families that share the service port, its tool and this rule. */
export type GatewayFamily = "blg20x" | "lbg20x"

/** The family a USB product string names: "LBG20 Gateway 1234" is an LBG20x, "BLG20 Gateway 286C" a BLG20x. */
export function gatewayFamilyFromProduct(product: string | null | undefined): GatewayFamily | undefined {
	if (!product) return undefined
	if (/\bLBG20\b/i.test(product)) return "lbg20x"
	if (/\bBLG20\b/i.test(product)) return "blg20x"
	return undefined
}

/** The family's name as people say it ("LBG20x") and as the unnamed form reads ("LBG20"). */
export const familyWord = (f: GatewayFamily | undefined): { x: string; bare: string } =>
	f === "lbg20x" ? { x: "LBG20x", bare: "LBG20" } : { x: "BLG20x", bare: "BLG20" }

/** One unit as the service tool's `list --ble --json` reports it. */
export interface Blg20BleRow {
	address: string
	name: string
	family?: string | null
	short?: string | null
	id?: string | null
	rssi?: number | null
	bonded?: boolean | null
	window?: boolean | null
}

export interface Blg20Unit {
	/** How it was recognised: its own USB-C service port, its Bluetooth service port, or the two debug probes. */
	via: "usb" | "ble" | "probes"
	/** Which gateway this is, read from the product string; absent when nothing named it (a probe pair). */
	family?: GatewayFamily
	/** Named BLG20 by the device itself: its USB product string (from pyserial or from nrfutil). False for
	 *  the test ids with no product string, and for a probe pair: "possibly a BLG20", to be confirmed. */
	confirmed: boolean
	/** USB serial number of the service port — the unit's identity when seen over USB. */
	serialNumber?: string
	/** The last four hex digits of the unit's Bluetooth address, as firmware 0.3.3+ puts them in the USB
	 *  product string ("BLG20 Gateway 286C"): how people name a unit (the case label, the commissioner's
	 *  chooser, "Adsum BLG20 FAA08F0D286C"). A NAME, never an identity: 65 536 values, so the serial
	 *  number stays the key for every action. Absent on older firmware. */
	name?: string
	/** The BLE half's service port (interface 0), e.g. "COM5" or "/dev/ttyACM0". */
	servicePort?: string
	/** The LTE tunnel (interface 2) — present only while the service port is unlocked. */
	ltePort?: string
	/** J-Link serial of the probe that reaches the nRF54LM20B (BLE half). */
	bleProbe?: string
	/** J-Link serial of the probe that reaches the nRF9151 (LTE half). */
	lteProbe?: string
	/** Bluetooth: how the computer addresses the unit (a MAC on Linux and Windows, a per-computer UUID on macOS). */
	bleAddress?: string
	/** Bluetooth: the unit's own address, the 12 hex digits of its advertised name. */
	bleId?: string
	/** Bluetooth: whether this computer holds a pairing with the unit (null: the OS does not say, as on macOS). */
	bonded?: boolean | null
	/** Bluetooth: its commissioning window is open (it advertises only then, so a seen unit says true). */
	windowOpen?: boolean
	/** Bluetooth: the signal, in dBm, when it was seen. */
	rssi?: number
	/**
	 * [11 Oct 2026] What the Hardware page's journey learnt from the unit over Bluetooth (the service tool's `status`,
	 * `claim` and the registry): paired this session, claimed and by whose key, the halves' versions, the latest
	 * release for the family and whether it is newer. Absent until the page connects.
	 */
	paired?: boolean
	claimed?: boolean
	/** The owner key is this computer's. */
	mine?: boolean
	bleFw?: string
	lteFw?: string
	latest?: { version: string; bleFw?: string | null; lteFw?: string | null; newer: boolean; ahead?: boolean; folder?: string }
	/** The last words the journey had for this unit (the tool's own sentence), shown under its row. */
	words?: string
}

/** The units the service tool saw over Bluetooth, as gateway units. Named by the device itself: confirmed. */
export function blg20UnitsFromBle(rows: Blg20BleRow[]): Blg20Unit[] {
	const out: Blg20Unit[] = []
	for (const r of rows) {
		const m = /^Adsum (BLG20|LBG20)x? ([0-9A-F]{12})$/i.exec(r.name ?? "")
		if (!m) continue
		const family: GatewayFamily = m[1].toUpperCase() === "LBG20" ? "lbg20x" : "blg20x"
		const id = m[2].toUpperCase()
		out.push({
			via: "ble",
			family,
			confirmed: true,
			name: id.slice(-4),
			bleAddress: r.address,
			bleId: id,
			bonded: r.bonded ?? null,
			windowOpen: r.window !== false,
			...(typeof r.rssi === "number" ? { rssi: r.rssi } : {}),
		})
	}
	return out
}

/** A unit seen over USB (or probes) and over Bluetooth is one unit: same family and same four digits. */
function mergeBleUnits(units: Blg20Unit[], ble: Blg20Unit[]): Blg20Unit[] {
	const out = [...units]
	for (const b of ble) {
		const same = out.findIndex((u) => u.confirmed && u.name && u.name === b.name && (u.family ?? "blg20x") === b.family)
		if (same >= 0) {
			const { via: _via, confirmed: _c, ...rest } = b
			out[same] = { ...out[same], ...rest, via: out[same].via }
		} else {
			out.push(b)
		}
	}
	return out
}

const toNum = (v: number | string | null | undefined): number | undefined =>
	v == null ? undefined : typeof v === "string" ? parseInt(v, 16) : v

/** The four-digit name from a USB product string, "BLG20 Gateway 286C" -> "286C"; undefined when absent. */
export function blg20NameFromProduct(product: string | null | undefined): string | undefined {
	return product?.match(/\b(BLG|LBG)20 Gateway ([0-9A-F]{4})\b/i)?.[2]?.toUpperCase()
}

/** Is this port a BLG20x service-port interface? */
export function isBlg20Port(p: Blg20RawPort): boolean {
	if (toNum(p.vid) !== BLG20_USB_VID || toNum(p.pid) !== BLG20_USB_PID) {
		return false
	}
	const product = (p.product ?? "").trim()
	if (!product) {
		return true // Windows: no product string — the ids are all the OS gives (the service tool's rule)
	}
	return /(blg|lbg)20/i.test(product) || /(blg|lbg)20/i.test(p.description ?? "")
}

/** Does the port NAME itself a BLG20 (product string or description), rather than only carry the test ids? */
export function blg20PortNamed(p: Blg20RawPort): boolean {
	return isBlg20Port(p) && (/(blg|lbg)20/i.test(p.product ?? "") || /(blg|lbg)20/i.test(p.description ?? ""))
}

/** Which USB interface a port is: 0 = service port, 2 = LTE tunnel, undefined = the OS did not say. */
export function blg20Interface(p: Blg20RawPort): number | undefined {
	// Linux "1-2:1.0"; pyserial on Windows writes "1-2:x.0". The digit after the dot is the interface.
	const loc = p.location?.match(/:[\dx]+\.(\d+)$/i)
	if (loc) {
		return Number(loc[1])
	}
	const mi = p.hwid?.match(/MI_(\d{2})/i)
	if (mi) {
		return Number(mi[1])
	}
	return undefined
}

/** Group the BLG20 ports by unit (USB serial) and tell the service port from the LTE tunnel. */
export function blg20UnitsFromPorts(ports: Blg20RawPort[]): Blg20Unit[] {
	const byUnit = new Map<string, Blg20RawPort[]>()
	for (const p of ports.filter(isBlg20Port)) {
		const key = p.serial_number?.trim() || `port:${p.device}`
		byUnit.set(key, [...(byUnit.get(key) ?? []), p])
	}
	const units: Blg20Unit[] = []
	for (const [key, list] of byUnit) {
		const unit: Blg20Unit = {
			via: "usb",
			confirmed: list.some(blg20PortNamed),
			serialNumber: key.startsWith("port:") ? undefined : key,
		}
		const name = list.map((p) => blg20NameFromProduct(p.product) ?? blg20NameFromProduct(p.description)).find(Boolean)
		if (name) {
			unit.name = name
		}
		const family = list
			.map((p) => gatewayFamilyFromProduct(p.product) ?? gatewayFamilyFromProduct(p.description))
			.find(Boolean)
		if (family) {
			unit.family = family
		}
		const unknown: Blg20RawPort[] = []
		for (const p of list) {
			const iface = blg20Interface(p)
			if (iface === 0) {
				unit.servicePort = p.device
			} else if (iface === 2) {
				unit.ltePort = p.device
			} else {
				unknown.push(p)
			}
		}
		// macOS names no interface: the service port enumerates first, so the lower name is it.
		unknown.sort((a, b) => a.device.localeCompare(b.device, undefined, { numeric: true }))
		for (const p of unknown) {
			if (!unit.servicePort) {
				unit.servicePort = p.device
			} else if (!unit.ltePort) {
				unit.ltePort = p.device
			}
		}
		units.push(unit)
	}
	return units
}

/** BLG20 units from nrfutil's device list: interface 0 is the service port, interface 2 the LTE tunnel. */
export function blg20UnitsFromNrfutil(devices: Blg20NrfutilDevice[]): Blg20Unit[] {
	return devices
		.filter((d) => /(blg|lbg)20/i.test(d.product ?? ""))
		.map((d) => {
			const byIface = (n: number) => d.ports.find((p) => p.interfaceNumber === n)?.path
			const ordered = [...d.ports].sort(
				(a, b) => (a.vcom ?? 99) - (b.vcom ?? 99) || a.path.localeCompare(b.path, undefined, { numeric: true }),
			)
			const known = d.ports.some((p) => p.interfaceNumber !== undefined)
			const name = blg20NameFromProduct(d.product)
			const family = gatewayFamilyFromProduct(d.product)
			return {
				via: "usb" as const,
				confirmed: true, // nrfutil read the USB product string itself, and it names the family
				serialNumber: d.serialNumber,
				...(name ? { name } : {}),
				...(family ? { family } : {}),
				servicePort: known ? byIface(0) : ordered[0]?.path,
				ltePort: known ? byIface(2) : ordered[1]?.path,
			}
		})
}

/** One unit per serial number: pyserial's interface reading wins, nrfutil fills what it lacks. */
function mergeUsbUnits(fromPorts: Blg20Unit[], fromNrfutil: Blg20Unit[]): Blg20Unit[] {
	const out = [...fromPorts]
	for (const n of fromNrfutil) {
		const same = out.findIndex((u) => u.serialNumber && u.serialNumber === n.serialNumber)
		if (same >= 0) {
			const u = out[same]
			out[same] = {
				...u,
				confirmed: u.confirmed || n.confirmed,
				...((u.name ?? n.name) ? { name: u.name ?? n.name } : {}),
				servicePort: u.servicePort ?? n.servicePort,
				ltePort: u.ltePort ?? n.ltePort,
			}
		} else {
			out.push(n)
		}
	}
	return out
}

const probeText = (b: Blg20ProbeBoard) => `${b.deviceName ?? ""} ${b.deviceVersion ?? ""} ${b.deviceFamily ?? ""}`

/** The BLG20's two chips seen through two probes: an nRF54LM20B and an nRF9151, both present. */
export function blg20FromProbes(boards: Blg20ProbeBoard[]): Blg20Unit | undefined {
	const ble = boards.find((b) => /nrf54lm20b/i.test(probeText(b).replace(/[\s_-]/g, "")))
	const lte = boards.find((b) => b !== ble && /nrf9151/i.test(probeText(b).replace(/[\s_-]/g, "")))
	if (!ble || !lte) {
		return undefined
	}
	return { via: "probes", confirmed: false, bleProbe: ble.serialNumber, lteProbe: lte.serialNumber }
}

/**
 * Every BLG20x on this computer. A unit on its USB port AND on the probes is the bench case: with exactly
 * one of each they are the same board, and are shown once.
 */
export function detectBlg20Units(
	ports: Blg20RawPort[],
	boards: Blg20ProbeBoard[],
	nrfutilDevices: Blg20NrfutilDevice[] = [],
	bleRows: Blg20BleRow[] = [],
): Blg20Unit[] {
	const usb = mergeUsbUnits(blg20UnitsFromPorts(ports), blg20UnitsFromNrfutil(nrfutilDevices))
	const ble = blg20UnitsFromBle(bleRows)
	const probes = blg20FromProbes(boards)
	if (!probes) {
		return mergeBleUnits(usb, ble)
	}
	if (usb.length === 1) {
		return mergeBleUnits([{ ...usb[0], bleProbe: probes.bleProbe, lteProbe: probes.lteProbe }], ble)
	}
	if (usb.length === 0 && ble.length === 1) {
		// The LBG20x on a bench: its probes and its Bluetooth port are the same board.
		return [{ ...ble[0], bleProbe: probes.bleProbe, lteProbe: probes.lteProbe }]
	}
	return mergeBleUnits([...usb, probes], ble)
}

/** True when the unit is reached over Bluetooth only (no service port on USB): the LBG20x's normal case. */
export function blg20OverBluetooth(u: Blg20Unit): boolean {
	return !!u.bleAddress && !u.servicePort
}

/** The name a command gives the tool for this unit over Bluetooth: its four digits ("--ble AD50"). */
export function blg20BleTarget(u: Blg20Unit): string | undefined {
	return u.bleAddress ? (u.name ?? u.bleId ?? u.bleAddress) : undefined
}

/**
 * How the first connection from this computer pairs, by its platform: macOS and Windows ask for the passkey in a
 * system dialog; Linux has no such dialog, so the tool answers the pairing itself from `--passkey`. The computer is
 * the one the extension host runs on (over Remote SSH, the remote machine), which is where the tool runs.
 */
/**
 * [11 Oct 2026, operator] The demo firmware's six digits, derived from the unit's twelve hex digits exactly as the
 * firmware derives them for its label (FNV-1a over the address bytes least-significant first, modulo a million):
 * the Coder fills them on Linux and shows them beside the computer's dialog elsewhere. A production unit with a
 * factory passkey refuses them, and the label's digits are asked for instead.
 */
export function blg20Passkey(bleId: string): string | undefined {
	const hex = bleId.replace(/[:\-\s]/g, "").toUpperCase()
	if (!/^[0-9A-F]{12}$/.test(hex)) return undefined
	let h = 2166136261
	for (let i = 10; i >= 0; i -= 2) {
		h = Math.imul(h ^ Number.parseInt(hex.slice(i, i + 2), 16), 16777619) >>> 0
	}
	return String(h % 1000000).padStart(6, "0")
}

export function blg20PairingWords(platform?: string, bonded?: boolean | null, bleId?: string): string {
	const digits = bleId ? blg20Passkey(bleId) : undefined
	if (platform !== "linux") {
		return digits
			? `the first time, the computer asks to pair: type ${digits} (DEMO firmware: its digits are derived from its address; a labelled unit takes the label's)`
			: "the first time, the computer asks to pair: type the six digits on the unit's label"
	}
	// Linux says whether this computer holds the pairing (the scan's `bonded`): paired needs nothing; not yet paired
	// needs the passkey on this very command, said as a fact rather than an "if". The demo firmware's digits are
	// derived, so `--passkey auto` is the whole of it.
	if (bonded === true) {
		return ""
	}
	return bonded === false
		? "this computer has no pairing with the unit yet: add `--passkey auto` to the command (Linux pairs through the tool; the demo firmware's digits are derived from its address, a labelled unit takes `--passkey <its six digits>`)"
		: "the first time, add `--passkey auto` to the command (Linux pairs through the tool; the demo firmware's digits are derived from its address)"
}

/**
 * The Flash prompt's way onto a unit reached over Bluetooth only (the LBG20x): one sentence the firmware rung puts
 * first. `folder` is the version's folder in the workspace (firmware/<family>/<version>), whose usb/demo set is what
 * Bluetooth flashes. Undefined for a unit on its cable or its probes: their own routes stand.
 */
export function blg20BleUnitRoute(u: Blg20Unit, folder: string, platform?: string): string | undefined {
	if (!blg20OverBluetooth(u)) return undefined
	const name = blg20BleTarget(u)
	const set = `${folder.replace(/[\\/]+$/, "")}/usb/demo`
	const pairing = blg20PairingWords(platform, u.bonded, u.bleId)
	return (
		`to ${blg20Label(u)} over Bluetooth with \`blg20-service update-pair --ble ${name} ${set} --json\` ` +
		`(both halves, the Bluetooth half first)${pairing ? `; ${pairing}` : ""}` +
		`${u.windowOpen === false ? ". Its commissioning window is closed: hold its button for three seconds first" : ""}`
	)
}

/** The Bluetooth facts in words, for a hover: "over Bluetooth · window open · paired · -64 dBm". */
export function blg20BleWords(u: Blg20Unit): string {
	if (!u.bleAddress) return ""
	const parts = ["over Bluetooth", u.windowOpen === false ? "window closed: hold its button 3 s" : "window open"]
	if (u.bonded === true) parts.push("paired")
	else if (u.bonded === false) parts.push("not paired yet")
	if (typeof u.rssi === "number") parts.push(`${u.rssi} dBm`)
	return parts.join(" · ")
}

/** The units something has named BLG20: the only ones a card may claim, or the agent may treat as a gateway. */
export function confirmedBlg20Units(units: Blg20Unit[] | undefined): Blg20Unit[] {
	return (units ?? []).filter((u) => u.confirmed)
}

/** J-Link serials that belong to a recognised BLG20 — their boards are the gateway, not two loose chips. */
export function blg20ProbeSerials(units: Blg20Unit[] | undefined): Set<string> {
	const s = new Set<string>()
	for (const u of units ?? []) {
		if (u.bleProbe) {
			s.add(u.bleProbe)
		}
		if (u.lteProbe) {
			s.add(u.lteProbe)
		}
	}
	return s
}

/**
 * One short label per unit, the way a person names it: "BLG20x 286C", the four digits being the end of
 * its Bluetooth address, which firmware 0.3.3+ puts in the USB product string. Nothing else: the ports
 * were there for the agent, which now reads them from the tool's own `list`; people never type them. Older
 * firmware gives no name, so the unit is named by its device id (the BLE half's hardware id, which is also
 * its USB serial number): "BLG20 9802AF5C69DF1E66". A unit nothing has named says so: "Possibly a BLG20
 * (2 debug probes), not confirmed". The ports and the id are in blg20LongLabel(), for a hover or a log.
 */
export function blg20Label(u: Blg20Unit): string {
	if (!u.confirmed) {
		return `Possibly a BLG20${blg20Where(u)}, not confirmed`
	}
	const w = familyWord(u.family)
	return u.name ? `${w.x} ${u.name}` : `${w.bare} ${u.serialNumber ?? "gateway"}`
}

/** Everything behind the name: "BLG20x 286C, unit BBA605799DE4043E (USB /dev/ttyACM3 + LTE tunnel /dev/ttyACM4)". */
export function blg20LongLabel(u: Blg20Unit): string {
	if (!u.confirmed) {
		return blg20Label(u)
	}
	const id = u.name && u.serialNumber ? `${familyWord(u.family).x} ${u.name}, unit ${u.serialNumber}` : blg20Label(u)
	return `${id}${blg20Where(u)}`
}

function blg20Where(u: Blg20Unit): string {
	const how: string[] = []
	if (u.servicePort) {
		how.push(`USB ${u.servicePort}${u.ltePort ? ` + LTE tunnel ${u.ltePort}` : ""}`)
	}
	if (u.bleAddress) {
		how.push(`${blg20BleWords(u)}, ${u.bleAddress}`)
	}
	if (u.bleProbe && u.lteProbe) {
		how.push("2 debug probes")
	}
	return how.length ? ` (${how.join(", ")})` : ""
}
