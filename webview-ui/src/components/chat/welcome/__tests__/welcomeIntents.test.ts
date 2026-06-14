import { describe, expect, it } from "vitest"
import {
	buildIntentPrompt,
	getTenure,
	type IntentId,
	NO_PROJECT_INTENTS,
	PROJECT_INTENTS,
	resolveIntentPlatform,
} from "../welcomeIntents"

describe("getTenure", () => {
	it("taskCount=0, showAnnouncement=false → new", () => {
		expect(getTenure({ taskCount: 0, showAnnouncement: false })).toBe("new")
	})
	it("taskCount=0, showAnnouncement=true → new (new wins over dormant)", () => {
		expect(getTenure({ taskCount: 0, showAnnouncement: true })).toBe("new")
	})
	it("taskCount=3, showAnnouncement=true → dormant", () => {
		expect(getTenure({ taskCount: 3, showAnnouncement: true })).toBe("dormant")
	})
	it("taskCount=3, showAnnouncement=false → returning", () => {
		expect(getTenure({ taskCount: 3, showAnnouncement: false })).toBe("returning")
	})
	it("taskCount=1, showAnnouncement=false → returning (1 task is not new)", () => {
		expect(getTenure({ taskCount: 1, showAnnouncement: false })).toBe("returning")
	})
})

describe("buildIntentPrompt", () => {
	const ids: IntentId[] = ["prototype", "addFeature", "debug", "buildFlash", "testValidate", "demo"]
	for (const id of ids) {
		it(`${id} returns a non-empty string`, () => {
			expect(buildIntentPrompt(id)).toBeTypeOf("string")
			expect(buildIntentPrompt(id)).not.toBe("")
		})
	}

	it("addFeature interpolates projectName", () => {
		expect(buildIntentPrompt("addFeature", "my_app")).toContain("my_app")
	})

	it("buildFlash interpolates projectName", () => {
		expect(buildIntentPrompt("buildFlash", "my_app")).toContain("my_app")
	})

	it("testValidate interpolates projectName", () => {
		expect(buildIntentPrompt("testValidate", "my_app")).toContain("my_app")
	})

	it("addFeature falls back gracefully when projectName omitted (no undefined in string)", () => {
		const result = buildIntentPrompt("addFeature")
		expect(result).toBeTypeOf("string")
		expect(result).not.toContain("undefined")
	})

	it("buildFlash falls back gracefully when projectName omitted", () => {
		expect(buildIntentPrompt("buildFlash")).not.toContain("undefined")
	})

	it("testValidate falls back gracefully when projectName omitted", () => {
		expect(buildIntentPrompt("testValidate")).not.toContain("undefined")
	})

	it("prototype does not change with projectName (it is not project-scoped)", () => {
		expect(buildIntentPrompt("prototype")).toBe(buildIntentPrompt("prototype", "irrelevant"))
	})

	it("prototype prompt is platform-specific (esp ≠ nrf ≠ both)", () => {
		const esp = buildIntentPrompt("prototype", undefined, "esp")
		const nrf = buildIntentPrompt("prototype", undefined, "nrf")
		const both = buildIntentPrompt("prototype", undefined, "both")
		expect(esp).toContain("ESP-IDF")
		expect(nrf).toContain("Nordic")
		expect(esp).not.toBe(nrf)
		expect(both).not.toBe(nrf)
	})
})

describe("resolveIntentPlatform", () => {
	it("an open, classified project wins over toolchain detection", () => {
		expect(resolveIntentPlatform("esp", { nrf: true, esp: false })).toBe("esp")
		expect(resolveIntentPlatform("nrf", { nrf: false, esp: true })).toBe("nrf")
		expect(resolveIntentPlatform("both", { nrf: true, esp: false })).toBe("both")
	})

	it("no project: biases to the single installed toolchain", () => {
		expect(resolveIntentPlatform("none", { nrf: false, esp: true })).toBe("esp")
		expect(resolveIntentPlatform("none", { nrf: true, esp: false })).toBe("nrf")
		expect(resolveIntentPlatform(undefined, { nrf: false, esp: true })).toBe("esp")
	})

	it("no project + both or neither toolchain → neutral 'both' (never silently nRF)", () => {
		expect(resolveIntentPlatform("none", { nrf: true, esp: true })).toBe("both")
		expect(resolveIntentPlatform("none", { nrf: false, esp: false })).toBe("both")
	})
})

describe("NO_PROJECT_INTENTS", () => {
	it("excludes project-only intent ids", () => {
		const ids = NO_PROJECT_INTENTS.map((d) => d.id)
		expect(ids).not.toContain("addFeature")
		expect(ids).not.toContain("debug")
		expect(ids).not.toContain("buildFlash")
		expect(ids).not.toContain("testValidate")
	})

	it("includes prototype", () => {
		expect(NO_PROJECT_INTENTS.map((d) => d.id)).toContain("prototype")
	})
})

describe("PROJECT_INTENTS", () => {
	it("has exactly one primary intent", () => {
		expect(PROJECT_INTENTS.filter((d) => d.primary)).toHaveLength(1)
	})

	it("buildFlashDebug is the primary", () => {
		expect(PROJECT_INTENTS.find((d) => d.primary)?.id).toBe("buildFlashDebug")
	})

	it("includes the live project intents (build/flash/debug merged) + roadmap cards", () => {
		const ids = PROJECT_INTENTS.map((d) => d.id)
		expect(ids).toContain("buildFlashDebug")
		expect(ids).toContain("addFeature")
		expect(ids).toContain("testValidate")
		// roadmap
		expect(ids).toContain("sdkMigration")
		expect(ids).toContain("boardBringUp")
		// standalone build/flash + debug were merged away
		expect(ids).not.toContain("buildFlash")
		expect(ids).not.toContain("debug")
	})

	it("roadmap cards are flagged comingSoon; live cards are not", () => {
		const soon = PROJECT_INTENTS.filter((d) => d.comingSoon).map((d) => d.id)
		expect(soon).toEqual(["sdkMigration", "boardBringUp"])
	})

	it("excludes no-project intents", () => {
		const ids = PROJECT_INTENTS.map((d) => d.id)
		expect(ids).not.toContain("prototype")
		expect(ids).not.toContain("openProject")
	})
})
