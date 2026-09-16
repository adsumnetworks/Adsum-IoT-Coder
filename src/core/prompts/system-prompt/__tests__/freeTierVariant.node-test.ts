/*
 * The free tier must be asked for tool calls in the format its model actually speaks.
 *
 * Its model id is "free-default" — opaque on purpose, so the forwarder can change what it serves
 * without the client knowing. Variant selection used to end in a NAME test, so that id matched no
 * family, fell through to the generic XML variant, and the model was asked for XML. It calls tools
 * natively, so it answered in its own markup and that markup spilled into the text channel with
 * its parameter openers missing:
 *
 *     <｜｜DSML｜｜ invoke name="read_file"> /path </｜｜DSML｜｜ invoke
 *
 * Nothing can parse that, the host reports "without value for required parameter 'path'", and the
 * model shrinks its output and retries until the session dies. Seen on a CRA run, then again on a
 * BLG20x bring-up, then by Omar.
 *
 * So these assert the SELECTION, which is where the bug was — not the string formatting downstream.
 */
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { ModelFamily } from "@/shared/prompts"
import { PromptRegistry } from "../registry/PromptRegistry"
import type { SystemPromptContext } from "../types"

const ctx = (providerId: string, modelId: string, extra: Record<string, unknown> = {}): SystemPromptContext =>
	({
		enableNativeToolCalls: true,
		providerInfo: { providerId, model: { id: modelId, info: extra.info ?? {} } },
		...extra,
	}) as unknown as SystemPromptContext

const familyFor = async (c: SystemPromptContext) => {
	const r = PromptRegistry.getInstance()
	await r.load?.()
	return r.getModelFamily(c)
}

describe("variant selection — the free tier gets native tool calls", () => {
	test("free-default on our own provider resolves to the native variant, not generic", async () => {
		assert.equal(await familyFor(ctx("adsum-free", "free-default")), ModelFamily.NATIVE_NEXT_GEN)
	})

	test("our provider is trusted whatever opaque id it serves", async () => {
		for (const id of ["free-default", "whatever-we-swap-to-next", "deepseek-flash"]) {
			assert.equal(await familyFor(ctx("adsum-free", id)), ModelFamily.NATIVE_NEXT_GEN, id)
		}
	})

	test("a declared capability beats the name, in both directions", async () => {
		// An id no family matcher recognises, on a provider that is allowed to reach this variant.
		assert.equal(
			await familyFor(ctx("openrouter", "some-vendor/renamed-2027", { info: { supportsNativeTools: true } })),
			ModelFamily.NATIVE_NEXT_GEN,
		)
		// And a NO is believed, even from our own provider, which the branch below would say yes to.
		assert.notEqual(
			await familyFor(ctx("adsum-free", "free-default", { info: { supportsNativeTools: false } })),
			ModelFamily.NATIVE_NEXT_GEN,
		)
	})

	test("the provider allow-list still comes first — a declaration cannot talk its way past it", async () => {
		// Deliberate: this widens to a declared capability and to our own provider, and to nothing
		// else. A forwarder we have never heard of does not get native tools by asserting it has
		// them, because the cost of being wrong is a dead session, not a slow one.
		assert.notEqual(
			await familyFor(ctx("some-forwarder", "unknown-model", { info: { supportsNativeTools: true } })),
			ModelFamily.NATIVE_NEXT_GEN,
		)
	})

	test("the switch still wins: native calls off means never the native variant", async () => {
		const c = ctx("adsum-free", "free-default")
		;(c as { enableNativeToolCalls?: boolean }).enableNativeToolCalls = false
		assert.notEqual(await familyFor(c), ModelFamily.NATIVE_NEXT_GEN)
	})

	test("a provider that is neither ours nor next-gen is unchanged", async () => {
		assert.notEqual(await familyFor(ctx("ollama", "llama3")), ModelFamily.NATIVE_NEXT_GEN)
	})

	test("GPT-5 keeps its own variant — the exclusion is not widened", async () => {
		assert.notEqual(await familyFor(ctx("openai", "gpt-5")), ModelFamily.NATIVE_NEXT_GEN)
	})

	// The neighbours, measured with the matcher reverted and again with it in place: every row
	// below was identical in both states, and free-default was the only row that moved. They are
	// pinned so a later widening of this matcher cannot quietly take a shipped provider with it —
	// GLM in particular sits on its own variant behind ENABLE_GLM_NATIVE_TOOL_CALLS.
	test("no other provider moves", async () => {
		const pins: Array<[string, string, string]> = [
			["anthropic", "claude-sonnet-4-6", "native-next-gen"],
			["gemini", "gemini-2.5-pro", "native-next-gen"],
			["openai", "gpt-5", "gpt-5-native"],
			["zai", "glm-5", "glm"],
			["ollama", "llama3", "generic"],
			["deepseek", "deepseek-flash", "native-next-gen"],
			["openrouter", "deepseek/deepseek-flash", "native-next-gen"],
		]
		for (const [provider, model, family] of pins) {
			assert.equal(await familyFor(ctx(provider, model)), family, `${provider}/${model}`)
		}
	})
})
