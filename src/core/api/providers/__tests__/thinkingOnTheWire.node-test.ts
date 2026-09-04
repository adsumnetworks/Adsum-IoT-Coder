import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { DeepSeekHandler } from "../deepseek"
import { OpenAiNativeHandler } from "../openai-native"
import { ZAiHandler } from "../zai"

/**
 * What actually goes on the wire — not what the source says it will send.
 *
 * [OPERATOR 2026-09-04] "and that it is properly fixed". The earlier tests for this defect match
 * regexes against the handler's source, which proves the text of the rule and nothing about its
 * effect — the same shape as the checks that passed all day while not looking. These build the
 * real handler, hand it a fake client, run a turn, and read the request body the client received.
 *
 * The case that shipped broken is the first one in each block: an effort chosen, no budget ever
 * written, and — before the fix — neither parameter sent, so the server's own default (high) won.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/api/providers/__tests__/thinkingOnTheWire.node-test.ts
 */

type Body = Record<string, any>

/** A client whose only job is to remember the body it was given and end the stream at once. */
const capture = () => {
	const seen: Body[] = []
	const client = {
		chat: {
			completions: {
				create: async (body: Body) => {
					seen.push(body)
					return (async function* () {})()
				},
			},
		},
	}
	return { client, seen }
}

const turn = async (handler: any, client: unknown): Promise<void> => {
	handler.client = client
	for await (const _ of handler.createMessage("system", [])) {
		// drain
	}
}

describe("DeepSeek V4: the request body", () => {
	const make = (opts: Record<string, unknown>) =>
		new DeepSeekHandler({ apiModelId: "deepseek-v4-flash", deepSeekApiKey: "k", ...opts } as any)

	test("effort chosen, budget never written → thinking enabled AND the effort — the shipped bug", async () => {
		const { client, seen } = capture()
		await turn(make({ reasoningEffort: "low" }), client)
		assert.deepEqual(seen[0].thinking, { type: "enabled" })
		assert.equal(seen[0].reasoning_effort, "low")
	})

	test("nothing chosen → nothing sent, and the server default stands", async () => {
		const { client, seen } = capture()
		await turn(make({}), client)
		assert.equal("thinking" in seen[0], false)
		assert.equal("reasoning_effort" in seen[0], false)
	})

	test("explicitly off with a stale effort → disabled, and no effort rides along", async () => {
		const { client, seen } = capture()
		await turn(make({ thinkingBudgetTokens: 0, reasoningEffort: "low" }), client)
		assert.deepEqual(seen[0].thinking, { type: "disabled" })
		assert.equal("reasoning_effort" in seen[0], false)
	})

	test("explicitly on with an effort → both, as before", async () => {
		const { client, seen } = capture()
		await turn(make({ thinkingBudgetTokens: 1024, reasoningEffort: "max" }), client)
		assert.deepEqual(seen[0].thinking, { type: "enabled" })
		assert.equal(seen[0].reasoning_effort, "max")
	})
})

describe("GLM (z.ai coding plan): the request body", () => {
	const make = (opts: Record<string, unknown>) =>
		new ZAiHandler({ apiModelId: "glm-5.2", zaiApiLine: "coding", zaiApiKey: "k", ...opts } as any)

	test("effort chosen, budget never written → thinking enabled AND the effort — the same bug", async () => {
		const { client, seen } = capture()
		await turn(make({ reasoningEffort: "high" }), client)
		assert.deepEqual(seen[0].thinking, { type: "enabled" })
		assert.equal(seen[0].reasoning_effort, "high")
	})

	test("nothing chosen → nothing sent", async () => {
		const { client, seen } = capture()
		await turn(make({}), client)
		assert.equal("thinking" in seen[0], false)
		assert.equal("reasoning_effort" in seen[0], false)
	})

	test("explicitly off with a stale effort → disabled, no effort", async () => {
		const { client, seen } = capture()
		await turn(make({ thinkingBudgetTokens: 0, reasoningEffort: "high" }), client)
		assert.deepEqual(seen[0].thinking, { type: "disabled" })
		assert.equal("reasoning_effort" in seen[0], false)
	})

	test("a model that does not take an effort never receives one, even with thinking on", async () => {
		const { client, seen } = capture()
		await turn(
			new ZAiHandler({ apiModelId: "glm-5-turbo", zaiApiLine: "coding", zaiApiKey: "k", reasoningEffort: "high" } as any),
			client,
		)
		assert.deepEqual(seen[0].thinking, { type: "enabled" })
		assert.equal("reasoning_effort" in seen[0], false)
	})
})

describe("OpenAI (native): the request body", () => {
	// The Feature Settings "OpenAI reasoning effort" dial reaches this handler through
	// Task.startTask, which copies the global into the per-mode reasoningEffort for openai-native.
	// The handler then gated on thinkingBudgetTokens — a field the OpenAI-native panel has NO
	// control for — so the effort was bridged in and dropped on the floor, every request, and the
	// telemetry that counts changes to that dial was counting a control with no effect.
	const make = (opts: Record<string, unknown>) =>
		new OpenAiNativeHandler({ apiModelId: "gpt-5.2", openAiNativeApiKey: "k", ...opts } as any)

	test("the dial's effort reaches the wire with no budget ever written — the shipped bug", async () => {
		const { client, seen } = capture()
		await turn(make({ reasoningEffort: "low" }), client)
		assert.equal(seen[0].reasoning_effort, "low")
	})

	test("no effort chosen → none sent, server default stands", async () => {
		const { client, seen } = capture()
		await turn(make({}), client)
		assert.equal(seen[0].reasoning_effort, undefined)
	})
})
