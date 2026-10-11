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
			"six digits when the computer asks",
			"forgets the unit in the computer's Bluetooth settings",
			"Never install Python packages for this tool",
			"one JSON object",
		]) {
			expect(bluetoothGatewayWords("darwin")).to.contain(words)
		}
	})

	it("on Linux (the bench over Remote SSH) the pairing rule is the tool's --passkey, not a system dialog", () => {
		const w = bluetoothGatewayWords("linux")
		expect(w).to.contain("add `--passkey auto` to that command")
		expect(w).not.to.contain("when the computer asks")
	})

	it("what the Hardware page's journey established is said, so the agent never pairs or claims twice", () => {
		const [u] = blg20UnitsFromBle([ROW])
		const e = blg20Evidence({
			...u,
			paired: true,
			claimed: true,
			mine: true,
			bleFw: "0.3.6",
			lteFw: "0.2.8",
			latest: { version: "1.1.0", newer: true },
		})
		expect(e).to.contain(
			"from the Hardware page: paired with this computer, claimed by this computer's key, Bluetooth half 0.3.6, cellular half 0.2.8, a newer release v1.1.0 is listed",
		)
		expect(blg20Evidence(u)).not.to.contain("from the Hardware page")
	})

	it("what the unit holds as commissioned is said with the unit's own verdict (11 Oct 2026)", () => {
		const [u] = blg20UnitsFromBle([ROW])
		const line = "commissioned · 53.24508, -1.44321 ±14 m · sends over LTE-M · MQTT without TLS to broker.emqx.io"
		const e = blg20Evidence({
			...u,
			paired: true,
			commission: { commissioned: true, line, verdict: { state: "warn", words: "Still checking." } },
		})
		expect(e).to.contain(`from the Hardware page: paired with this computer, ${line} (the unit says: Still checking.)`)
		expect(blg20Evidence({ ...u, paired: true, commission: { commissioned: false, line: "not commissioned" } })).to.contain(
			"paired with this computer, not commissioned",
		)
	})

	it("commissioning is done from this computer, with the bit and the verbs named", () => {
		const w = bluetoothGatewayWords("darwin")
		expect(w).to.contain("products/fanstel/blg20x/commission-from-the-coder.md")
		expect(w).to.contain("`blg20-service prov ... --ble <its four digits> --json`")
		expect(w).to.contain("the browser page is for an installer with a phone")
	})
})
