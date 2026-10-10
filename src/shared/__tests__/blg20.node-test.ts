import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
	type Blg20NrfutilDevice,
	type Blg20RawPort,
	blg20FromProbes,
	blg20Interface,
	blg20Label,
	blg20LongLabel,
	blg20NameFromProduct,
	blg20ProbeSerials,
	blg20UnitsFromNrfutil,
	blg20UnitsFromPorts,
	confirmedBlg20Units,
	detectBlg20Units,
	isBlg20Port,
} from "../blg20"

/**
 * Recognising a connected BLG20x. The Linux ports and the probe targets below are what the bench
 * reported on 7 Oct 2026 (pyserial comports() and `nrfutil device device-info`), not made up.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/shared/__tests__/blg20.node-test.ts
 */

const LINUX: Blg20RawPort[] = [
	{
		device: "/dev/ttyACM1",
		vid: 0x1209,
		pid: 0x0001,
		product: "BLG20 Gateway",
		serial_number: "9802AF5C69DF1E66",
		location: "1-4:1.2",
		description: "BLG20 Gateway - BLG20 LTE tunnel",
		hwid: "USB VID:PID=1209:0001 SER=9802AF5C69DF1E66 LOCATION=1-4:1.2",
	},
	{
		device: "/dev/ttyACM0",
		vid: 0x1209,
		pid: 0x0001,
		product: "BLG20 Gateway",
		serial_number: "9802AF5C69DF1E66",
		location: "1-4:1.0",
		description: "BLG20 Gateway - BLG20 BLE service",
		hwid: "USB VID:PID=1209:0001 SER=9802AF5C69DF1E66 LOCATION=1-4:1.0",
	},
	{ device: "/dev/ttyACM2", vid: 0x1366, pid: 0x1069, serial_number: "001051878474", location: "1-2:1.0" },
]

/** The bench's two probes, rewired 7 Oct: nRF5340 DK → BLE half, nRF54L15 DK → LTE half. */
/** What `nrfutil device list --json` said about the same unit on the bench, 7 Oct (trimmed to the fields read). */
const NRFUTIL: Blg20NrfutilDevice[] = [
	{
		serialNumber: "9802AF5C69DF1E66",
		product: "BLG20 Gateway",
		ports: [
			{ path: "/dev/ttyACM0", interfaceNumber: 0, vcom: 0 },
			{ path: "/dev/ttyACM1", interfaceNumber: 2, vcom: 1 },
		],
	},
]

const PROBES = [
	{ serialNumber: "960167369", deviceVersion: "NRF54LM20B_xxAA_ENGB", deviceFamily: "NRF54L_FAMILY" },
	{ serialNumber: "1051878474", deviceVersion: "NRF9151_LACA_REV3", deviceFamily: "NRF91_FAMILY" },
]

describe("BLG20x over its USB service port", () => {
	test("the bench's two ports are one unit: interface 0 the service port, interface 2 the LTE tunnel", () => {
		assert.deepEqual(blg20UnitsFromPorts(LINUX), [
			{
				via: "usb",
				confirmed: true,
				serialNumber: "9802AF5C69DF1E66",
				servicePort: "/dev/ttyACM0",
				ltePort: "/dev/ttyACM1",
			},
		])
	})

	test("Windows: no product string, the interface comes from MI_xx (or pyserial's x.N location) - and the unit is NOT confirmed", () => {
		const win: Blg20RawPort[] = [
			{ device: "COM7", vid: 0x1209, pid: 1, serial_number: "AB12", hwid: "USB\\VID_1209&PID_0001&MI_02\\7&1" },
			{ device: "COM5", vid: 0x1209, pid: 1, serial_number: "AB12", location: "1-2:x.0" },
		]
		const units = blg20UnitsFromPorts(win)
		assert.deepEqual(units, [{ via: "usb", confirmed: false, serialNumber: "AB12", servicePort: "COM5", ltePort: "COM7" }])
		assert.equal(blg20Label(units[0]), "Possibly a BLG20 (USB COM5 + LTE tunnel COM7), not confirmed")
	})

	test("Windows: nrfutil names the same unit, so it is confirmed", () => {
		const win: Blg20RawPort[] = [{ device: "COM5", vid: 0x1209, pid: 1, serial_number: "AB12", location: "1-2:x.0" }]
		const nrf: Blg20NrfutilDevice[] = [
			{ serialNumber: "AB12", product: "BLG20 Gateway", ports: [{ path: "COM5", interfaceNumber: 0 }] },
		]
		const units = detectBlg20Units(win, [], nrf)
		assert.equal(units.length, 1)
		assert.equal(units[0].confirmed, true)
		assert.equal(blg20Label(units[0]), "BLG20 AB12")
		assert.equal(blg20LongLabel(units[0]), "BLG20 AB12 (USB COM5)")
	})

	test("firmware 0.3.3+ names the unit by the end of its Bluetooth address: BLG20x 286C, the id behind it", () => {
		const ports: Blg20RawPort[] = [
			{
				device: "/dev/ttyACM3",
				vid: 0x1209,
				pid: 1,
				product: "BLG20 Gateway 286C",
				serial_number: "BBA605799DE4043E",
				location: "1-4:1.0",
			},
			{
				device: "/dev/ttyACM4",
				vid: 0x1209,
				pid: 1,
				product: "BLG20 Gateway 286C",
				serial_number: "BBA605799DE4043E",
				location: "1-4:1.2",
			},
		]
		const units = blg20UnitsFromPorts(ports)
		assert.equal(units[0].name, "286C")
		assert.equal(units[0].serialNumber, "BBA605799DE4043E")
		assert.equal(blg20Label(units[0]), "BLG20x 286C")
		assert.equal(blg20LongLabel(units[0]), "BLG20x 286C, unit BBA605799DE4043E (USB /dev/ttyACM3 + LTE tunnel /dev/ttyACM4)")
		// nrfutil reads the same string; a Windows port with no product string takes the name from nrfutil
		const win = detectBlg20Units(
			[{ device: "COM5", vid: 0x1209, pid: 1, serial_number: "BBA605799DE4043E", location: "1-2:x.0" }],
			[],
			[{ serialNumber: "BBA605799DE4043E", product: "BLG20 Gateway 286C", ports: [{ path: "COM5", interfaceNumber: 0 }] }],
		)
		assert.equal(blg20Label(win[0]), "BLG20x 286C")
		assert.equal(blg20LongLabel(win[0]), "BLG20x 286C, unit BBA605799DE4043E (USB COM5)")
		// the name is never mistaken for the product match: a plain "BLG20 Gateway" has none
		assert.equal(blg20NameFromProduct("BLG20 Gateway"), undefined)
		assert.equal(blg20NameFromProduct("BLG20 Gateway 286c"), "286C")
	})

	test("a locked unit shows its service port only", () => {
		const locked = blg20UnitsFromPorts([LINUX[1]])
		assert.equal(locked[0].servicePort, "/dev/ttyACM0")
		assert.equal(locked[0].ltePort, undefined)
		assert.equal(blg20Label(locked[0]), "BLG20 9802AF5C69DF1E66")
		assert.equal(blg20LongLabel(locked[0]), "BLG20 9802AF5C69DF1E66 (USB /dev/ttyACM0)")
	})

	test("macOS names no interface: the lower port name is the service port", () => {
		const mac: Blg20RawPort[] = [
			{ device: "/dev/cu.usbmodem98023", vid: 0x1209, pid: 1, product: "BLG20 Gateway", serial_number: "98" },
			{ device: "/dev/cu.usbmodem98021", vid: 0x1209, pid: 1, product: "BLG20 Gateway", serial_number: "98" },
		]
		const [u] = blg20UnitsFromPorts(mac)
		assert.deepEqual([u.servicePort, u.ltePort], ["/dev/cu.usbmodem98021", "/dev/cu.usbmodem98023"])
	})

	test("pid.codes' shared test ids alone are not a BLG20 when the product string says otherwise", () => {
		assert.equal(isBlg20Port({ device: "/dev/ttyACM9", vid: 0x1209, pid: 1, product: "Some Other Gadget" }), false)
		assert.equal(isBlg20Port({ device: "/dev/ttyACM9", vid: 0x1209, pid: 2, product: "BLG20 Gateway" }), false)
		assert.equal(isBlg20Port({ device: "/dev/ttyUSB0", vid: 0x10c4, pid: 0xea60, product: "CP2102" }), false)
	})

	test("two units stay two", () => {
		const two = [LINUX[1], { ...LINUX[1], device: "/dev/ttyACM5", serial_number: "1111" }]
		assert.equal(blg20UnitsFromPorts(two).length, 2)
	})

	test("interface parsing", () => {
		assert.equal(blg20Interface({ device: "x", location: "1-4:1.2" }), 2)
		assert.equal(blg20Interface({ device: "x", location: "1-14.1.2:1.0" }), 0)
		assert.equal(blg20Interface({ device: "x", hwid: "USB\\VID_1209&PID_0001&MI_00\\6&2" }), 0)
		assert.equal(blg20Interface({ device: "x" }), undefined)
	})
})

describe("BLG20x on two debug probes", () => {
	test("an nRF54LM20B and an nRF9151 behind two probes are the gateway's chip pair", () => {
		assert.deepEqual(blg20FromProbes(PROBES), {
			via: "probes",
			confirmed: false,
			bleProbe: "960167369",
			lteProbe: "1051878474",
		})
	})

	test("an nRF54LM20 DK (A silicon) with an nRF9151 DK is not a BLG20", () => {
		const dks = [
			{ serialNumber: "1", deviceVersion: "NRF54LM20A_xxAA_REV1" },
			{ serialNumber: "2", deviceVersion: "NRF9151_LACA_REV3" },
		]
		assert.equal(blg20FromProbes(dks), undefined)
	})

	test("one chip alone proves nothing", () => {
		assert.equal(blg20FromProbes([PROBES[0]]), undefined)
		assert.equal(blg20FromProbes([PROBES[1]]), undefined)
	})
})

describe("both at once — the bench", () => {
	test("one unit on USB and the probe pair are the same board, shown once", () => {
		const units = detectBlg20Units(LINUX, PROBES)
		assert.equal(units.length, 1)
		assert.deepEqual(units[0], {
			via: "usb",
			confirmed: true,
			serialNumber: "9802AF5C69DF1E66",
			servicePort: "/dev/ttyACM0",
			ltePort: "/dev/ttyACM1",
			bleProbe: "960167369",
			lteProbe: "1051878474",
		})
		assert.equal(blg20Label(units[0]), "BLG20 9802AF5C69DF1E66")
		assert.equal(
			blg20LongLabel(units[0]),
			"BLG20 9802AF5C69DF1E66 (USB /dev/ttyACM0 + LTE tunnel /dev/ttyACM1, 2 debug probes)",
		)
		assert.deepEqual([...blg20ProbeSerials(units)].sort(), ["1051878474", "960167369"])
	})

	test("probes only (no USB cable): one unit, POSSIBLY a BLG20, never claimed", () => {
		const units = detectBlg20Units([], PROBES)
		assert.deepEqual(units, [{ via: "probes", confirmed: false, bleProbe: "960167369", lteProbe: "1051878474" }])
		assert.equal(blg20Label(units[0]), "Possibly a BLG20 (2 debug probes), not confirmed")
		assert.deepEqual(confirmedBlg20Units(units), [])
	})

	test("nothing connected: nothing detected", () => {
		assert.deepEqual(detectBlg20Units([LINUX[2]], []), [])
	})
})

describe("BLG20x from nrfutil's device list (no pyserial needed)", () => {
	test("the bench unit: interface 0 the service port, interface 2 the LTE tunnel", () => {
		assert.deepEqual(blg20UnitsFromNrfutil(NRFUTIL), [
			{
				via: "usb",
				confirmed: true,
				serialNumber: "9802AF5C69DF1E66",
				servicePort: "/dev/ttyACM0",
				ltePort: "/dev/ttyACM1",
			},
		])
	})

	test("no interface numbers: nrfutil's vcom order decides", () => {
		const d = [
			{
				serialNumber: "AB",
				product: "BLG20 Gateway",
				ports: [
					{ path: "COM9", vcom: 1 },
					{ path: "COM8", vcom: 0 },
				],
			},
		]
		assert.deepEqual(blg20UnitsFromNrfutil(d)[0], {
			via: "usb",
			confirmed: true,
			serialNumber: "AB",
			servicePort: "COM8",
			ltePort: "COM9",
		})
	})

	test("a J-Link or any other product is not a BLG20", () => {
		assert.deepEqual(blg20UnitsFromNrfutil([{ serialNumber: "001051878474", product: "J-Link", ports: [] }]), [])
	})

	test("nrfutil alone (no pyserial) with the probes: one unit, named by its device id", () => {
		const units = detectBlg20Units([], PROBES, NRFUTIL)
		assert.equal(units.length, 1)
		assert.equal(blg20Label(units[0]), "BLG20 9802AF5C69DF1E66")
		assert.equal(
			blg20LongLabel(units[0]),
			"BLG20 9802AF5C69DF1E66 (USB /dev/ttyACM0 + LTE tunnel /dev/ttyACM1, 2 debug probes)",
		)
	})

	test("pyserial and nrfutil both see it: still one unit", () => {
		assert.equal(detectBlg20Units(LINUX, [], NRFUTIL).length, 1)
	})
})
