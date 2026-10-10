import { blg20BleUnitRoute, blg20UnitsFromBle, blg20UnitsFromNrfutil } from "@shared/blg20"
import { describe, expect, it } from "vitest"
import { flashPrompt } from "../flashPrompt"
import { bleSetUpPrompt, unitActions } from "../unitActions"

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
		for (const a of [what, claim, logs]) expect(a.prompt).toContain("six digits on the unit's label")
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
			expect(a.prompt).toContain(
				"This computer has no pairing with the unit yet: add `--passkey <the six digits on the unit's label>` to the command (Linux pairs through the tool).",
			)
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
