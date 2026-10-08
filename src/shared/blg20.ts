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

export interface Blg20Unit {
	/** How it was recognised: its own USB-C service port, or the two debug probes on its two chips. */
	via: "usb" | "probes"
	/** Named BLG20 by the device itself: its USB product string (from pyserial or from nrfutil). False for
	 *  the test ids with no product string, and for a probe pair: "possibly a BLG20", to be confirmed. */
	confirmed: boolean
	/** USB serial number of the service port — the unit's identity when seen over USB. */
	serialNumber?: string
	/** The BLE half's service port (interface 0), e.g. "COM5" or "/dev/ttyACM0". */
	servicePort?: string
	/** The LTE tunnel (interface 2) — present only while the service port is unlocked. */
	ltePort?: string
	/** J-Link serial of the probe that reaches the nRF54LM20B (BLE half). */
	bleProbe?: string
	/** J-Link serial of the probe that reaches the nRF9151 (LTE half). */
	lteProbe?: string
}

const toNum = (v: number | string | null | undefined): number | undefined =>
	v == null ? undefined : typeof v === "string" ? parseInt(v, 16) : v

/** Is this port a BLG20x service-port interface? */
export function isBlg20Port(p: Blg20RawPort): boolean {
	if (toNum(p.vid) !== BLG20_USB_VID || toNum(p.pid) !== BLG20_USB_PID) {
		return false
	}
	const product = (p.product ?? "").trim()
	if (!product) {
		return true // Windows: no product string — the ids are all the OS gives (the service tool's rule)
	}
	return /blg20/i.test(product) || /blg20/i.test(p.description ?? "")
}

/** Does the port NAME itself a BLG20 (product string or description), rather than only carry the test ids? */
export function blg20PortNamed(p: Blg20RawPort): boolean {
	return isBlg20Port(p) && (/blg20/i.test(p.product ?? "") || /blg20/i.test(p.description ?? ""))
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
		.filter((d) => /blg20/i.test(d.product ?? ""))
		.map((d) => {
			const byIface = (n: number) => d.ports.find((p) => p.interfaceNumber === n)?.path
			const ordered = [...d.ports].sort(
				(a, b) => (a.vcom ?? 99) - (b.vcom ?? 99) || a.path.localeCompare(b.path, undefined, { numeric: true }),
			)
			const known = d.ports.some((p) => p.interfaceNumber !== undefined)
			return {
				via: "usb" as const,
				confirmed: true, // nrfutil read the USB product string itself, and it says BLG20
				serialNumber: d.serialNumber,
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
): Blg20Unit[] {
	const usb = mergeUsbUnits(blg20UnitsFromPorts(ports), blg20UnitsFromNrfutil(nrfutilDevices))
	const probes = blg20FromProbes(boards)
	if (!probes) {
		return usb
	}
	if (usb.length === 1) {
		return [{ ...usb[0], bleProbe: probes.bleProbe, lteProbe: probes.lteProbe }]
	}
	return [...usb, probes]
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
 * One short label per unit, named by its device id (the BLE half's hardware id, which is also its USB
 * serial number), e.g. "BLG20 9802AF5C69DF1E66 (USB COM5 + LTE tunnel COM6)". A unit nothing has named
 * says so: "Possibly a BLG20 (2 debug probes), not confirmed".
 */
export function blg20Label(u: Blg20Unit): string {
	const how: string[] = []
	if (u.servicePort) {
		how.push(`USB ${u.servicePort}${u.ltePort ? ` + LTE tunnel ${u.ltePort}` : ""}`)
	}
	if (u.bleProbe && u.lteProbe) {
		how.push("2 debug probes")
	}
	const where = how.length ? ` (${how.join(", ")})` : ""
	return u.confirmed ? `BLG20 ${u.serialNumber ?? "gateway"}${where}` : `Possibly a BLG20${where}, not confirmed`
}
