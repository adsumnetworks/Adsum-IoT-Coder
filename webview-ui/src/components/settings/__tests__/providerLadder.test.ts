import * as fs from "node:fs"
import * as path from "node:path"
import PROVIDERS from "@shared/providers/providers.json"
import { describe, expect, it } from "vitest"

/**
 * The Settings provider dropdown is a CURATED allowlist, and it is the only place an API key can be
 * entered. A provider missing from it is unreachable no matter how complete its implementation is.
 *
 * Reported 2026-08-16: "the deepseek provider support!!! it doesn't exist yet!!!" — after a release that
 * fixed DeepSeek's native tool calling, pricing, context window and in-chat picker entry. Every one of
 * those fixes was invisible, because the dropdown that grants access never listed it, so the only way to
 * use DeepSeek remained hand-configuring the generic OpenAI-compatible provider.
 *
 * These tests tie the curated list to the things that depend on it.
 */

const APIOPTIONS = path.join(__dirname, "..", "ApiOptions.tsx")
const MODEL_PICKER = path.join(__dirname, "..", "..", "chat", "ModelPickerModal.tsx")

/** The allowedProviders array literal from ApiOptions.tsx, in display order. */
function curatedProviders(): string[] {
	const src = fs.readFileSync(APIOPTIONS, "utf8")
	const block = src.match(/const allowedProviders = \[([\s\S]*?)\]/)
	if (!block) {
		throw new Error("could not find allowedProviders in ApiOptions.tsx")
	}
	return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

describe("settings provider ladder", () => {
	it("lists DeepSeek — it is a first-class provider and this dropdown is the only way to add its key", () => {
		expect(curatedProviders()).toContain("deepseek")
	})

	it("every curated value exists in providers.json, or it silently renders nothing", () => {
		const known = new Set(PROVIDERS.list.map((p: { value: string }) => p.value))
		const unknown = curatedProviders().filter((v) => !known.has(v))
		expect(unknown, `curated providers missing from providers.json: ${unknown.join(", ")}`).toEqual([])
	})

	it("keeps the free tier first — the ladder starts where a new developer can start", () => {
		expect(curatedProviders()[0]).toBe("adsum-free")
	})

	it("every provider offered in the in-chat picker can also be configured in Settings", () => {
		// The picker only lists providers that already have a key, and a key can only be entered here.
		// A provider in one list and not the other is either unreachable or unswitchable.
		const picker = fs.readFileSync(MODEL_PICKER, "utf8")
		const block = picker.match(/return allProviders\.filter\(([\s\S]*?)\)\s*\}, \[/)
		if (!block) {
			throw new Error("could not find the picker's provider filter")
		}
		const pickerProviders = [...block[1].matchAll(/p === "([^"]+)"/g)].map((m) => m[1])
		const curated = new Set(curatedProviders())
		// "zai-coding-plan" is curated; the picker also accepts plain "zai" for already-configured installs.
		const unreachable = pickerProviders.filter((p) => !curated.has(p) && p !== "zai" && p !== "zai-coding-plan")
		expect(unreachable, `offered in chat but not configurable in Settings: ${unreachable.join(", ")}`).toEqual([])
	})
})
