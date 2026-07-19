import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import { normalizeApiConfiguration } from "../providerUtils"

/**
 * Regression: "Your own coding agent" must survive normalization.
 *
 * The switch's `default` returns Anthropic's models, so an unknown provider is silently RENAMED to
 * anthropic — which is what shipped: selecting the agent provider rendered Anthropic's API-key form,
 * its label, and its pricing. Any provider that isn't an inference backend needs its own case, and
 * this test is the guard.
 */
describe("normalizeApiConfiguration — external-agent", () => {
	const cfg = (mode: "plan" | "act"): ApiConfiguration =>
		({ [`${mode}ModeApiProvider`]: "external-agent" }) as unknown as ApiConfiguration

	it("keeps the provider identity in both modes (never falls back to anthropic)", () => {
		expect(normalizeApiConfiguration(cfg("act"), "act").selectedProvider).toBe("external-agent")
		expect(normalizeApiConfiguration(cfg("plan"), "plan").selectedProvider).toBe("external-agent")
	})

	it("reports no model — it hands work over instead of calling one", () => {
		const n = normalizeApiConfiguration(cfg("act"), "act")
		expect(n.selectedModelId).toBe("")
		// crucially: not an Anthropic model id, and no borrowed pricing/context to render
		expect(n.selectedModelId).not.toMatch(/claude/i)
		expect(n.selectedModelInfo?.inputPrice).toBeUndefined()
		expect(n.selectedModelInfo?.contextWindow).toBeUndefined()
	})
})
