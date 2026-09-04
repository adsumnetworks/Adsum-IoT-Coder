import { describe, expect, it } from "vitest"
import { rank, type Signals, type Suggestable } from "../suggest"

const base: Signals = {
	nrfBoards: [],
	espDevices: [],
	classification: "none",
	toolchains: { nrf: false, esp: false },
	features: { hasBle: false, hasWifi: false, hasCompliance: false },
	hasWorkspace: false,
}

const CATALOGUE: Suggestable[] = [
	{
		id: "gateway",
		platform: "product",
		need: "lew840x",
		whyNeutral: "needs the gateway, its bridge board and a Nordic DK as probe",
	},
	{ id: "nrfProto", platform: "nrf" },
	{ id: "espProto", platform: "esp" },
	{ id: "nrfSniffer", platform: "nrf" },
	{ id: "espDebug", platform: "esp" },
	{ id: "craCheck", platform: "both" },
]

const ids = (s: Signals) => rank(CATALOGUE, s).map((r) => r.item.id)
const whyOf = (s: Signals, id: string) => rank(CATALOGUE, s).find((r) => r.item.id === id)?.why

describe("rank — a connected board is intent", () => {
	it("an nRF board on the desk puts the nRF runs first, and says so", () => {
		const s = { ...base, nrfBoards: ["nRF52840 DK"], hasWorkspace: true }
		expect(
			ids(s)
				.slice(0, 2)
				.every((i) => i.startsWith("nrf")),
		).toBe(true)
		expect(whyOf(s, "nrfProto")).toBe("nRF52840 DK connected")
	})

	it("an ESP device does the same on its side", () => {
		const s = { ...base, espDevices: ["ESP32"], hasWorkspace: true }
		expect(
			ids(s)
				.slice(0, 2)
				.every((i) => i.startsWith("esp")),
		).toBe(true)
		expect(whyOf(s, "espDebug")).toBe("ESP32 connected")
	})

	it("a connected board outranks a merely installed toolchain", () => {
		const s = { ...base, espDevices: ["ESP32"], toolchains: { nrf: true, esp: false }, hasWorkspace: true }
		expect(ids(s)[0].startsWith("esp")).toBe(true)
	})
})

describe("rank — the product", () => {
	it("a recognised product project takes the top with its own reason", () => {
		const s = { ...base, product: "lew840x", hasWorkspace: true }
		expect(ids(s)[0]).toBe("gateway")
		expect(whyOf(s, "gateway")).toContain("lew840x")
	})

	it("with only part of its silicon present it ranks high but says only that", () => {
		const s = { ...base, nrfBoards: ["nRF52840 DK"], hasWorkspace: true }
		expect(whyOf(s, "gateway")).toBe("some of this product's silicon is on the bench")
	})

	it("with nothing detected it states the requirement rather than pretending to a match", () => {
		expect(whyOf(base, "gateway")).toContain("bridge board")
	})
})

describe("rank — the CRA rule, kept", () => {
	it("fires on a connectivity stack with no SBOM, and names the evidence", () => {
		const s: Signals = { ...base, hasWorkspace: true, features: { hasBle: true, hasWifi: true, hasCompliance: false } }
		expect(whyOf(s, "craCheck")).toBe("BLE and Wi-Fi in this project and no SBOM yet")
	})

	it("stops firing once compliance artifacts exist", () => {
		const s: Signals = { ...base, hasWorkspace: true, features: { hasBle: true, hasWifi: false, hasCompliance: true } }
		expect(whyOf(s, "craCheck")).not.toContain("no SBOM")
	})

	it("does not fire with no project open — there is nothing to scan", () => {
		const s: Signals = { ...base, features: { hasBle: true, hasWifi: true, hasCompliance: false } }
		expect(whyOf(s, "craCheck")).not.toContain("no SBOM")
	})
})

describe("rank — a requirement is not evidence it is met", () => {
	it("with a folder open and NO boards, a run you can start now beats one needing hardware to buy", () => {
		// [SCREENSHOT 2026-09-04] An empty scratch folder with nothing plugged in led with the
		// gateway build — "needs the gateway, its UART bridge board and a Nordic DK as probe".
		// True, and the worst possible first offer to someone who has none of it.
		const s: Signals = { ...base, hasWorkspace: true }
		const order = rank(CATALOGUE, s).map((r) => r.item.id)
		expect(order.indexOf("craCheck")).toBeLessThan(order.indexOf("gateway"))
	})

	it("but with the product actually recognised it still leads", () => {
		const s: Signals = { ...base, hasWorkspace: true, product: "lew840x" }
		expect(rank(CATALOGUE, s)[0].item.id).toBe("gateway")
	})
})

describe("rank — never silently one platform", () => {
	it("with nothing detected the two platforms alternate", () => {
		const order = ids(base).filter((i) => i.startsWith("nrf") || i.startsWith("esp"))
		expect(order[0].startsWith("nrf")).toBe(true)
		expect(order[1].startsWith("esp")).toBe(true)
		expect(order[2].startsWith("nrf")).toBe(true)
		expect(order[3].startsWith("esp")).toBe(true)
	})

	it("and says plainly that it is a mix, not a recommendation", () => {
		expect(whyOf(base, "nrfProto")).toBe("no board detected — showing a mix")
	})
})

describe("rank — never hides", () => {
	it("every catalogue entry comes back, whatever the signals", () => {
		for (const s of [base, { ...base, nrfBoards: ["nRF52840 DK"] }, { ...base, product: "lew840x" }]) {
			expect(rank(CATALOGUE, s)).toHaveLength(CATALOGUE.length)
		}
	})

	it("every entry carries a reason — a silent row would be worse than a wrong one", () => {
		for (const r of rank(CATALOGUE, base)) {
			expect(r.why.length).toBeGreaterThan(0)
		}
	})
})
