import { strict as assert } from "node:assert"
import { describe, test } from "node:test"
import type { ApiConfiguration } from "@shared/api"
import { convertApiConfigurationToProto, convertProtoToApiConfiguration } from "./api-configuration-conversion"

/**
 * The provider crosses the webview↔host wire as a proto ENUM, and BOTH conversion directions end in
 * `default → ANTHROPIC`. So a provider without an enum member does not fail loudly — it silently comes
 * back as "anthropic", which is exactly what shipped: picking "Your own coding agent" rendered
 * Anthropic's key form, because the value never survived the round trip.
 *
 * Any provider in the ApiProvider union must therefore survive this test.
 */
describe("api configuration proto round-trip", () => {
	const roundTrip = (cfg: ApiConfiguration): ApiConfiguration =>
		convertProtoToApiConfiguration(convertApiConfigurationToProto(cfg))

	test("external-agent survives the wire in both modes (never degrades to anthropic)", () => {
		const out = roundTrip({
			planModeApiProvider: "external-agent",
			actModeApiProvider: "external-agent",
		} as ApiConfiguration)
		assert.equal(out.planModeApiProvider, "external-agent")
		assert.equal(out.actModeApiProvider, "external-agent")
	})

	test("every provider the picker offers survives the wire", () => {
		// The curated ladder shown in Settings — a missing enum member here is invisible until a user
		// picks that provider and lands on someone else's config panel.
		for (const p of ["adsum-free", "external-agent", "zai-coding-plan", "anthropic", "openrouter", "openai"] as const) {
			const out = roundTrip({ actModeApiProvider: p } as ApiConfiguration)
			assert.equal(out.actModeApiProvider, p, `${p} must survive the proto round trip`)
		}
	})

	test("the external-agent setup preferences survive the wire", () => {
		const out = roundTrip({
			actModeApiProvider: "external-agent",
			externalAgentKind: "other",
			externalAgentAutoMcp: false,
			externalAgentManageClaudeMd: false,
			externalAgentWriteAgentsMd: true,
		} as ApiConfiguration)
		assert.equal(out.externalAgentKind, "other")
		assert.equal(out.externalAgentAutoMcp, false, "an OFF toggle must not come back as its default ON")
		assert.equal(out.externalAgentManageClaudeMd, false)
		assert.equal(out.externalAgentWriteAgentsMd, true)
	})
})

/**
 * The keyless-call backstop. "Your own coding agent" has no model, so the provider factory must never
 * fall through to the AnthropicHandler default — that would make real Anthropic calls with no key.
 *
 * The backstop used to be a throw inside the factory, which also made a Task impossible to CONSTRUCT,
 * so every past session became unopenable while the provider was selected. It now lives on the call
 * itself: constructing and reading are safe, calling a model is not.
 */
describe("external-agent never reaches a real inference backend", () => {
	test("the handler renders, but refuses to call anything", async () => {
		const { ExternalAgentHandler, NEEDS_A_MODEL } = await import("@core/api/providers/external-agent")
		const h = new ExternalAgentHandler()
		// getModel must be safe: the token/context UI calls it while rendering a past session.
		assert.equal(h.getModel().id, "external-agent")
		assert.ok((h.getModel().info.contextWindow ?? 0) > 0, "a zero context window would break the context UI")
		assert.throws(() => h.createMessage("sys", []), /hands work over instead of calling a model/)
		assert.match(NEEDS_A_MODEL, /Settings/, "the message must tell the developer what to do next")
	})
})
