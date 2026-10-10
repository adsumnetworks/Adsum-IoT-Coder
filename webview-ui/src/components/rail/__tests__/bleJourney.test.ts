import { blg20UnitsFromBle } from "@shared/blg20"
import { describe, expect, it } from "vitest"
import { isPasskey, journeySteps, rowWords } from "../bleJourney"

const ROW = { address: "D3:58:8E:7A:AD:50", name: "Adsum LBG20x D3588E7AAD50", rssi: -59, bonded: false, window: true }
const [fresh] = blg20UnitsFromBle([ROW])

describe("the Bluetooth journey on the Hardware page (11 Oct 2026)", () => {
	it("a unit never connected offers Connect first, with the passkey on Linux only", () => {
		expect(journeySteps(fresh, "darwin")).toEqual([{ id: "connect", action: "Connect", needsPasskey: false }])
		expect(journeySteps(fresh, "linux")[0].needsPasskey).toBe(true)
		expect(journeySteps({ ...fresh, bonded: true }, "linux")[0].needsPasskey).toBe(false)
	})
	it("a closed window blocks the connection and says what opens it", () => {
		const s = journeySteps({ ...fresh, windowOpen: false }, "darwin")
		expect(s[0].blocked).toContain("hold its button for three seconds")
	})
	it("once paired: claim next, then the firmware check", () => {
		const s = journeySteps({ ...fresh, paired: true, bleFw: "0.3.6", lteFw: "0.2.8" }, "darwin")
		expect(s.map((x) => x.id)).toEqual(["connect", "claim", "firmware"])
		expect(s[0].done).toBe("paired · Bluetooth half 0.3.6, cellular half 0.2.8")
		expect(s[1].action).toBe("Claim")
		expect(s[2].action).toBe("Check firmware")
	})
	it("claimed by another key is a fact with the way out, not a button", () => {
		const s = journeySteps({ ...fresh, paired: true, claimed: true, mine: false }, "darwin")
		expect(s[1].done).toBe("claimed by another computer's key")
		expect(s[1].blocked).toContain("owner-clear")
		expect(s[1].action).toBeUndefined()
	})
	it("a newer release proposes the upgrade and points at the Flash row; the same release says up to date", () => {
		const base = { ...fresh, paired: true, claimed: true, mine: true, bleFw: "0.3.6", lteFw: "0.2.8" }
		const newer = journeySteps(
			{ ...base, latest: { version: "1.1.0", bleFw: "0.3.7", lteFw: "0.2.9", newer: true } },
			"darwin",
		)
		expect(newer[2].done).toBe(
			"newer available: v1.1.0 (Bluetooth half 0.3.7, cellular half 0.2.9): Flash v1.1.0 over Bluetooth below",
		)
		const same = journeySteps(
			{ ...base, latest: { version: "1.0.0", bleFw: "0.3.6", lteFw: "0.2.8", newer: false } },
			"darwin",
		)
		expect(same[2].done).toBe("up to date: v1.0.0 is what it runs")
		const ahead = journeySteps(
			{
				...base,
				bleFw: "0.3.7",
				lteFw: "0.2.9",
				latest: { version: "1.0.0", bleFw: "0.3.6", lteFw: "0.2.8", newer: false, ahead: true },
			},
			"darwin",
		)
		expect(ahead[2].done).toBe(
			"runs a newer build than the latest release v1.0.0 (Bluetooth half 0.3.6, cellular half 0.2.8)",
		)
	})
	it("the row's line and the passkey rule", () => {
		expect(rowWords(fresh)).toBe("-59 dBm · window open · not paired yet")
		expect(rowWords({ ...fresh, paired: true })).toBe("-59 dBm · window open · paired")
		expect(isPasskey("776803")).toBe(true)
		expect(isPasskey("77680")).toBe(false)
	})
})
