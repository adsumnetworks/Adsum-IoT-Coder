import { blg20UnitsFromBle } from "@shared/blg20"
import { describe, expect, it } from "vitest"
import { isPasskey, journeySteps, rowWords } from "../bleJourney"

const ROW = { address: "D3:58:8E:7A:AD:50", name: "Adsum LBG20x D3588E7AAD50", rssi: -59, bonded: false, window: true }
const [fresh] = blg20UnitsFromBle([ROW])

describe("the Bluetooth journey on the Hardware page (11 Oct 2026)", () => {
	it("a unit never connected offers Connect first: Linux fills the demo digits itself, the Mac shows them for its dialog", () => {
		expect(journeySteps(fresh, "linux")).toEqual([{ id: "connect", action: "Connect", needsPasskey: false }])
		const mac = journeySteps(fresh, "darwin")[0]
		expect(mac.passkeyHint).toBe("the computer asks to pair: type 776803 (DEMO firmware)")
		expect(journeySteps({ ...fresh, bonded: true }, "darwin")[0].passkeyHint).toBeUndefined()
	})
	it("a closed window blocks the connection and says what opens it", () => {
		const s = journeySteps({ ...fresh, windowOpen: false }, "darwin")
		expect(s[0].blocked).toContain("hold its button for three seconds")
	})
	it("once paired: claim next, then the firmware check", () => {
		const s = journeySteps({ ...fresh, paired: true, bleFw: "0.3.6", lteFw: "0.2.8" }, "darwin")
		expect(s.map((x) => x.id)).toEqual(["connect", "claim", "firmware", "commission"])
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
	it("the fourth step: what the unit holds as commissioned, and one action that opens a session", () => {
		const paired = { ...fresh, paired: true, claimed: true, mine: true, bleFw: "0.3.6", lteFw: "0.2.8" }
		// a tool without the commissioner's facts: the action, no guess
		expect(journeySteps(paired, "darwin")[3]).toEqual({ id: "commission", action: "Commission it" })
		const notYet = journeySteps(
			{
				...paired,
				commission: {
					commissioned: false,
					line: "not commissioned",
					window: "open (not commissioned, so it stays open)",
				},
			},
			"darwin",
		)[3]
		expect(notYet.done).toBe("not commissioned")
		expect(notYet.action).toBe("Commission it")
		expect(notYet.primary).toBe(true)
		expect(notYet.info).toContain("stays open")
		const line = "commissioned · 53.24508, -1.44321 ±14 m · sends over LTE-M · MQTT without TLS to broker.emqx.io"
		const held = journeySteps(
			{
				...paired,
				commission: {
					commissioned: true,
					line,
					verdict: {
						state: "warn",
						words: "Still checking: a first send can take a few minutes; read the status again.",
					},
					window: "open, closes 3:52 after you disconnect",
				},
			},
			"darwin",
		)[3]
		expect(held.done).toBe("commissioned · still checking")
		expect(held.action).toBe("Change…")
		expect(held.primary).toBeUndefined()
		expect(held.info).toBe(
			`${line} Still checking: a first send can take a few minutes; read the status again. Window: open, closes 3:52 after you disconnect.`,
		)
		// the verdict is words, never a colour: go, warn and stop each say it
		const words = (state: "go" | "warn" | "stop") =>
			journeySteps({ ...paired, commission: { commissioned: true, line, verdict: { state, words: "" } } }, "darwin")[3].done
		expect([words("go"), words("warn"), words("stop")]).toEqual([
			"commissioned · working",
			"commissioned · still checking",
			"commissioned · not working yet",
		])
		// a claim by another computer does not block it: commissioning needs no owner key
		const other = journeySteps(
			{ ...paired, mine: false, commission: { commissioned: false, line: "not commissioned" } },
			"darwin",
		)
		expect(other[3].action).toBe("Commission it")
		expect(other[3].blocked).toBeUndefined()
	})
	it("a unit not yet paired shows no commissioning step", () => {
		expect(journeySteps(fresh, "linux").map((s) => s.id)).toEqual(["connect"])
	})
	it("the step's words fit the narrow rail: under forty characters with its action", () => {
		for (const state of ["go", "warn", "stop"] as const) {
			const s = journeySteps(
				{ ...fresh, paired: true, commission: { commissioned: true, line: "x", verdict: { state, words: "" } } },
				"darwin",
			)[3]
			expect(`${s.done} ${s.action}`.length).toBeLessThanOrEqual(40)
		}
	})
	it("the row's line and the passkey rule", () => {
		expect(rowWords(fresh)).toBe("-59 dBm · window open · not paired yet")
		expect(rowWords({ ...fresh, paired: true })).toBe("-59 dBm · window open · paired")
		expect(isPasskey("776803")).toBe(true)
		expect(isPasskey("77680")).toBe(false)
	})
})
