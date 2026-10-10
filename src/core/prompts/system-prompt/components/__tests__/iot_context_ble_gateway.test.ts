import { blg20UnitsFromBle, detectBlg20Units } from "@shared/blg20"
import { expect } from "chai"
import { describe, it } from "mocha"
import { blg20Evidence, bluetoothGatewayWords } from "../iot_context"

/**
 * [10 Oct 2026] The LBG20x's service port is Bluetooth only. What the agent is told about a unit seen that way, and
 * the rules it must follow, came from the bench (the service port over Bluetooth, milestones 1 to 3).
 */
describe("iot_context — a gateway over Bluetooth", () => {
	const ROW = {
		address: "D3:58:8E:7A:AD:50",
		name: "Adsum LBG20x D3588E7AAD50",
		short: "AD50",
		id: "D3588E7AAD50",
		rssi: -64,
		bonded: true,
		window: true,
	}

	it("names the unit, how it was seen and the exact command form", () => {
		const [u] = blg20UnitsFromBle([ROW])
		const e = blg20Evidence(u)
		expect(e).to.contain("named LBG20x AD50")
		expect(e).to.contain("over Bluetooth · window open · paired")
		expect(e).to.contain("`blg20-service <verb> --ble AD50 --json`")
	})

	it("says the window is closed and what opens it", () => {
		const [u] = blg20UnitsFromBle([{ ...ROW, window: false }])
		expect(blg20Evidence(u)).to.contain("window closed: hold its button 3 s")
	})

	it("a unit with its cable is driven over the cable, the Bluetooth door mentioned as well", () => {
		const [u] = detectBlg20Units(
			[],
			[],
			[
				{
					serialNumber: "BBA605799DE4043E",
					product: "BLG20 Gateway 286C",
					ports: [{ path: "/dev/ttyACM3", interfaceNumber: 0 }],
				},
			],
			[{ ...ROW, name: "Adsum BLG20 FAA08F0D286C", address: "FA:A0:8F:0D:28:6C" }],
		)
		const e = blg20Evidence(u)
		expect(e).to.contain("USB service port /dev/ttyACM3")
		expect(e).to.contain("also reachable over Bluetooth")
	})

	it("the rules: --ble, the window, the pairing digits, a stale pairing, nothing to install, one JSON line", () => {
		for (const words of [
			"`--ble <its four digits>`",
			"held for three seconds",
			"six digits from the unit's label",
			"forgets the unit in the computer's Bluetooth settings",
			"Never install Python packages for this tool",
			"one JSON object",
		]) {
			expect(bluetoothGatewayWords("darwin")).to.contain(words)
		}
	})

	it("on Linux (the bench over Remote SSH) the pairing rule is the tool's --passkey, not a system dialog", () => {
		const w = bluetoothGatewayWords("linux")
		expect(w).to.contain("add `--passkey <the six digits from the unit's label>` to that command")
		expect(w).not.to.contain("when the computer asks")
	})
})
