import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ApiProviderInfo } from "@/core/api"
import { ModelFamily } from "@/shared/prompts"
import type { SystemPromptContext } from "../types"
import { VARIANT_CONFIGS } from "../variants"

/**
 * WHICH PROMPT THE FREE TIER GETS, AND WHY IT MATTERS.
 *
 * 16 Sep 2026, a CRA run on the free tier: every `write_to_file` failed with "without value for
 * required parameter 'content'", five times, the model shrinking its own JSON each retry, nothing
 * written. The text it actually sent was its NATIVE call markup —
 * `<｜｜DSML｜｜ invoke name="write_to_file">` — with the parameter OPENING tokens stripped and only
 * the closing ones surviving, which no XML parser can read and the DSML normalizer cannot either
 * (it needs the openers).
 *
 * The model was not misbehaving: it is trained to call tools natively, and proven to do it cleanly
 * when `tools` are sent (verified against the vendor the same day — one structured tool_call, right
 * arguments, no markup in the text). It only reaches for its own markup when we ask for XML instead.
 *
 * The reason we asked for XML is this: the variant matcher decides by MODEL NAME, and the free
 * tier's id is `free-default` — opaque on purpose, so the forwarder can change what it serves
 * without the client knowing. `isNextGenModelProvider` and the DeepSeek name list were both already
 * taught about us; the matcher was not, so the provider fell through to the generic XML variant,
 * which carries no native tools.
 *
 * The rule this locks: our own provider's capability is answered by the provider, never by reading
 * a name it deliberately does not expose.
 */
const freeTier = (mode: "act" | "plan" = "act"): ApiProviderInfo => ({
	providerId: "adsum-free",
	model: { id: "free-default", info: {} as never },
	mode,
})

const familyFor = (providerInfo: ApiProviderInfo, enableNativeToolCalls: boolean): ModelFamily => {
	const context = { providerInfo, enableNativeToolCalls } as unknown as SystemPromptContext
	// Same walk the registry does in getModelFamily: first matching variant wins, a throwing
	// matcher counts as no match, and nothing matching means the generic XML prompt.
	for (const [family, config] of Object.entries(VARIANT_CONFIGS)) {
		try {
			if ((config as { matcher?: (c: SystemPromptContext) => boolean }).matcher?.(context)) {
				return family as ModelFamily
			}
		} catch {
			// A throwing matcher is a no-match, exactly as the registry treats it.
		}
	}
	return ModelFamily.GENERIC
}

describe("the free tier's prompt variant", () => {
	it("is the native one, so the served model is asked for the calls it actually makes", () => {
		assert.equal(familyFor(freeTier(), true), ModelFamily.NATIVE_NEXT_GEN)
	})

	it("is native in plan mode too — the leak was never mode-specific", () => {
		assert.equal(familyFor(freeTier("plan"), true), ModelFamily.NATIVE_NEXT_GEN)
	})

	it("still honours the developer turning native calls off, rather than forcing them", () => {
		assert.notEqual(familyFor(freeTier(), false), ModelFamily.NATIVE_NEXT_GEN)
	})

	it("does not hand the native variant to a provider that never claimed it", () => {
		const unknown: ApiProviderInfo = { providerId: "ollama", model: { id: "llama-3.2-1b", info: {} as never }, mode: "act" }
		assert.notEqual(familyFor(unknown, true), ModelFamily.NATIVE_NEXT_GEN)
	})

	it("believes a catalogue that declares the capability, in either direction", () => {
		const declared = (supportsNativeTools: boolean): ApiProviderInfo => ({
			providerId: "openrouter",
			model: { id: "some-new-model-nobody-has-a-pattern-for", info: { supportsNativeTools } as never },
			mode: "act",
		})
		assert.equal(familyFor(declared(true), true), ModelFamily.NATIVE_NEXT_GEN)
		assert.notEqual(familyFor(declared(false), true), ModelFamily.NATIVE_NEXT_GEN)
	})
})

/**
 * The neighbours, measured before the matcher was touched and pinned here after.
 *
 * The fix widens one matcher, and a widened matcher is exactly the kind that quietly steals another
 * variant's models — GLM has its own for a reason, and GPT-5 has two. This table is the proof it
 * stole nothing, and the alarm if someone widens it again.
 */
describe("the other providers keep the variant they had", () => {
	const cases: Array<[provider: string, modelId: string, nativeOn: string, nativeOff: string]> = [
		["anthropic", "claude-sonnet-4-6", "native-next-gen", "next-gen"],
		["openai", "gpt-5", "gpt-5-native", "gpt-5"],
		// The DeepSeek key path, on the vendor's current name: native both ways round is the point —
		// this is the same model the free tier forwards to, reached with the developer's own key.
		["deepseek", "deepseek-flash", "native-next-gen", "next-gen"],
		["zai", "glm-5", "glm", "glm"],
		["gemini", "gemini-2.5-pro", "native-next-gen", "next-gen"],
		["ollama", "llama-3.2-1b", "generic", "generic"],
	]

	for (const [providerId, modelId, nativeOn, nativeOff] of cases) {
		it(`${providerId}/${modelId}`, () => {
			const providerInfo: ApiProviderInfo = { providerId, model: { id: modelId, info: {} as never }, mode: "act" }
			assert.equal(familyFor(providerInfo, true), nativeOn, "with native calls on")
			assert.equal(familyFor(providerInfo, false), nativeOff, "with native calls off")
		})
	}
})
