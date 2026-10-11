import { blg20BleUnitRoute, blg20Label, blg20UnitsFromBle, blg20UnitsFromNrfutil } from "@shared/blg20"
import { describe, expect, it } from "vitest"
import { flashPrompt, flashTitle } from "../flashPrompt"
import {
	bleCommissionPrompt,
	bleSetUpPrompt,
	commissionTitle,
	setUpTitle,
	TAB_TITLE_MAX,
	tabTitle,
	unitActions,
	unitGuardKey,
} from "../unitActions"

// As the service tool's scan reported the bench unit, 10 Oct 2026.
const [lbg] = blg20UnitsFromBle([
	{ address: "D3:58:8E:7A:AD:50", name: "Adsum LBG20x D3588E7AAD50", rssi: -64, bonded: true, window: true },
])
const [blg] = blg20UnitsFromNrfutil([
	{ serialNumber: "BBA605799DE4043E", product: "BLG20 Gateway 286C", ports: [{ path: "/dev/ttyACM3", interfaceNumber: 0 }] },
])

describe("the unit's own actions (10 Oct 2026)", () => {
	it("over Bluetooth every command names the unit with --ble and the pairing is said", () => {
		const [what, claim, logs] = unitActions(lbg)
		expect(what.label).toBe("What is this gateway?")
		expect(what.prompt).toContain("`blg20-service passport --ble AD50 --json`")
		expect(claim.prompt).toContain("`blg20-service claim --ble AD50 --json`")
		expect(claim.prompt).toContain("commissioning window open")
		expect(logs.prompt).toContain("--chip lte --ble AD50 --json")
		for (const a of [what, claim, logs]) expect(a.prompt).toContain("type 776803")
	})
	it("on Linux (the bench over Remote SSH) the bond decides: paired says nothing, not yet paired says --passkey as a fact", () => {
		for (const a of unitActions(lbg, "linux")) {
			expect(a.prompt).not.toContain("passkey")
			expect(a.prompt).not.toContain("computer asks")
			expect(a.prompt).toContain("If it is not found, its commissioning window is closed")
		}
		const [fresh] = blg20UnitsFromBle([
			{ address: "D3:58:8E:7A:AD:50", name: "Adsum LBG20x D3588E7AAD50", rssi: -64, bonded: false, window: true },
		])
		for (const a of unitActions(fresh, "linux")) {
			expect(a.prompt).toContain("This computer has no pairing with the unit yet: add `--passkey auto` to the command")
		}
		for (const a of unitActions(fresh, "darwin")) {
			expect(a.prompt).toContain("type 776803")
		}
		expect(bleSetUpPrompt(fresh, "linux")).toContain("--passkey")
		expect(bleSetUpPrompt(lbg, "linux")).not.toContain("passkey")
	})
	it("on its cable the tool finds the unit by itself: no --ble, no pairing", () => {
		for (const a of unitActions(blg)) {
			expect(a.prompt).not.toContain("--ble")
			expect(a.prompt).not.toContain("six digits")
		}
	})
	it("Set it up over Bluetooth says the unit is in range, not plugged in", () => {
		const p = bleSetUpPrompt(lbg)
		expect(p).toContain("LBG20x AD50 gateway is in Bluetooth range")
		expect(p).toContain("--ble AD50")
		expect(p).not.toContain("plugged into this computer's USB")
	})
	it("the Flash prompt for an LBG20x puts the Bluetooth route first and offers no cable", () => {
		const folder = "firmware/lbg20x/1.0.0"
		const p = flashPrompt({
			title: "LBG20x demo pair",
			version: "1.0.0",
			licensee: "dev@acme.example",
			folder,
			files: [
				"bm20/merged.hex",
				"nrf9151/merged.hex",
				"usb/release.json",
				"usb/demo/ble.signed.bin",
				"usb/demo/lte.signed.bin",
			],
			family: "lbg20x",
			unitRoute: blg20BleUnitRoute(lbg, folder),
		})
		expect(p).toContain("blg20-service update-pair --ble AD50 firmware/lbg20x/1.0.0/usb/demo --json")
		expect(p).not.toContain("over its USB service port")
		expect(p.indexOf("over Bluetooth")).toBeLessThan(p.indexOf(".hex"))
	})
})

/**
 * [0.5.1 bench] A tab opened from a Hardware page button read "New session". Each button names its tab now:
 * what was asked, and of which unit. The host cuts a first title at 48 characters, so none is longer.
 */
describe("the tab titles of the Hardware page's buttons", () => {
	// Older firmware gives no four digits: the unit is named by its device id, the longest label there is.
	const [unnamed] = blg20UnitsFromNrfutil([
		{ serialNumber: "9802AF5C69DF1E66", product: "BLG20 Gateway", ports: [{ path: "COM7", interfaceNumber: 0 }] },
	])

	it("every unit action has a title that names the unit and fits the tab", () => {
		for (const u of [lbg, blg, unnamed]) {
			const label = blg20Label(u)
			const actions = unitActions(u)
			expect(actions).toHaveLength(3)
			for (const a of actions) {
				expect(a.title).toContain(label)
				expect(a.title.length).toBeLessThanOrEqual(TAB_TITLE_MAX)
				expect(a.title).not.toContain("—")
			}
		}
		expect(unitActions(lbg).map((a) => a.title)).toEqual([
			"What is this gateway? · LBG20x AD50",
			"Claim · LBG20x AD50",
			"Logs · LBG20x AD50",
		])
		expect(unitActions(unnamed)[0].title).toBe("What is this gateway? · BLG20 9802AF5C69DF1E66")
	})

	it("Set it up and Flash name their tabs too", () => {
		expect(setUpTitle(blg20Label(lbg))).toBe("Set up LBG20x AD50")
		expect(setUpTitle("Fanstel BLG20XE02C")).toBe("Set up Fanstel BLG20XE02C")
		expect(flashTitle({ title: "LBG20x demo pair", version: "1.0.0" })).toBe("Flash LBG20x demo pair v1.0.0")
	})

	it("a title too long for the tab is cut with an ellipsis, and a flash keeps its version", () => {
		const long = tabTitle(`Set up ${"a very long board name ".repeat(4)}`)
		expect(long.length).toBeLessThanOrEqual(TAB_TITLE_MAX)
		expect(long.endsWith("…")).toBe(true)
		const flash = flashTitle({ title: "BLG20x production pair with the long range radio card", version: "2.3.10" })
		expect(flash.length).toBeLessThanOrEqual(TAB_TITLE_MAX)
		expect(flash.startsWith("Flash BLG20x production pair")).toBe(true)
		expect(flash.endsWith("… v2.3.10")).toBe(true)
	})
})

/**
 * [0.5.1] The unit a button is about, as the host's port guard names it, so the host can continue in the session
 * that already holds the unit. The key follows the door the button's own commands use.
 */
describe("the unit's guard key", () => {
	it("over Bluetooth only: BLE and the unit's four digits", () => {
		expect(unitGuardKey(lbg)).toBe("BLE:AD50")
		expect(unitGuardKey(lbg, "ble")).toBe("BLE:AD50")
		// No name: the address in the advertised name, or a MAC, still gives the four digits.
		expect(unitGuardKey({ ...lbg, name: undefined })).toBe("BLE:AD50")
		expect(unitGuardKey({ ...lbg, name: undefined, bleId: undefined, bleAddress: "d3:58:8e:7a:ad:50" })).toBe("BLE:AD50")
	})

	it("on its cable: the service port, upper-cased as the guard stores it", () => {
		const [acm4] = blg20UnitsFromNrfutil([
			{
				serialNumber: "BBA605799DE4043E",
				product: "BLG20 Gateway 286C",
				ports: [{ path: "/dev/ttyACM4", interfaceNumber: 0 }],
			},
		])
		expect(unitGuardKey(acm4)).toBe("/DEV/TTYACM4")
		const [com] = blg20UnitsFromNrfutil([
			{ serialNumber: "BBA605799DE4043E", product: "BLG20 Gateway 286C", ports: [{ path: "COM7", interfaceNumber: 0 }] },
		])
		expect(unitGuardKey(com)).toBe("COM7")
		// macOS: the guard reads the call-out device as its tty twin.
		expect(unitGuardKey({ ...com, servicePort: "/dev/cu.usbmodem1101" })).toBe("/DEV/TTY.USBMODEM1101")
	})

	it("on both doors: the one the button's commands use, which is the cable", () => {
		const both = { ...blg, bleAddress: "FA:A0:8F:0D:28:6C", bleId: "FAA08F0D286C" }
		expect(unitGuardKey(both)).toBe("/DEV/TTYACM3")
		expect(unitGuardKey(both, "ble")).toBe("BLE:286C")
		for (const a of unitActions(both)) {
			expect(a.prompt).not.toContain("--ble")
			expect(a.unit).toBe("/DEV/TTYACM3")
		}
	})

	it("every unit action carries the key of its own unit", () => {
		for (const a of unitActions(lbg)) expect(a.unit).toBe("BLE:AD50")
		for (const a of unitActions(blg)) expect(a.unit).toBe("/DEV/TTYACM3")
	})

	it("unknown: no key, and no `unit` on the action", () => {
		expect(unitGuardKey(undefined)).toBeUndefined()
		// A probe pair has neither door.
		const probes = { via: "probes" as const, confirmed: false, bleProbe: "1050000001", lteProbe: "1050000002" }
		expect(unitGuardKey(probes)).toBeUndefined()
		expect(unitGuardKey(probes, "ble")).toBeUndefined()
		// Asked for a door the unit does not have.
		expect(unitGuardKey(lbg, "usb")).toBeUndefined()
		expect(unitGuardKey(blg, "ble")).toBeUndefined()
		// macOS addresses a unit by a per-computer UUID: with no name and no advertised address, nothing names it.
		const uuid = { ...lbg, name: undefined, bleId: undefined, bleAddress: "6F1C2B0A-93D4-4E57-A1B2-0C3D4E5F6A7B" }
		expect(unitGuardKey(uuid)).toBeUndefined()
		for (const a of unitActions(uuid)) expect("unit" in a).toBe(false)
	})
})

describe("the commissioning session (11 Oct 2026)", () => {
	const [ad50] = blg20UnitsFromBle([
		{ address: "D3:58:8E:7A:AD:50", name: "Adsum LBG20x D3588E7AAD50", rssi: -59, bonded: true, window: true },
	])
	it("opens the knowledge bit and reads the unit first, by its four digits", () => {
		const p = bleCommissionPrompt(ad50, "darwin")
		expect(p).toContain("LOAD products/fanstel/blg20x/commission-from-the-coder.md")
		expect(p).toContain("`blg20-service prov status --ble AD50 --json`")
		expect(p).toContain("one question at a time")
		expect(p).toContain("fleet register only")
		expect(commissionTitle(ad50)).toBe("Commission LBG20x AD50")
	})
	it("a commissioned unit is changed, not commissioned again: only what the developer names is written", () => {
		const u = { ...ad50, commission: { commissioned: true, line: "commissioned" } }
		expect(bleCommissionPrompt(u, "darwin")).toContain("ask me what to change, write only that")
		expect(commissionTitle(u)).toBe("Change LBG20x AD50")
	})
	it("on Linux with no pairing yet it says how the first connection pairs", () => {
		const u = { ...ad50, bonded: false }
		expect(bleCommissionPrompt(u, "linux")).toMatch(/passkey/i)
	})
})
