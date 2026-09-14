import { strict as assert } from "node:assert"
import { buildProviderBlock, mergeAdvancedBody, sellersAboveCeiling, sortIsOverridden } from "../openrouter-routing"

describe("routing — the block the settings describe", () => {
	it("sends nothing but the tool requirement when the developer has asked for nothing", () => {
		assert.deepEqual(buildProviderBlock({}), { require_parameters: true })
		assert.deepEqual(buildProviderBlock({ requireToolCalls: false }), undefined)
	})

	it("carries exactly what the settings say, in the API's own field names", () => {
		assert.deepEqual(
			buildProviderBlock({
				order: ["together", " deepinfra ", ""],
				onlyThese: true,
				maxInputPrice: 0.5,
				maxOutputPrice: 1.5,
				requireToolCalls: true,
			}),
			{
				order: ["together", "deepinfra"],
				allow_fallbacks: false,
				max_price: { prompt: 0.5, completion: 1.5 },
				require_parameters: true,
			},
		)
	})

	it("never sends allow_fallbacks true — a default is not a decision", () => {
		const block = buildProviderBlock({ onlyThese: false, order: ["together"] })
		assert.equal("allow_fallbacks" in (block ?? {}), false)
	})

	it("drops the sort when a seller list is set, because the two contradict", () => {
		assert.deepEqual(buildProviderBlock({ sort: "price" }), { sort: "price", require_parameters: true })
		const withOrder = buildProviderBlock({ sort: "price", order: ["together"] })
		assert.equal(withOrder?.sort, undefined)
		assert.deepEqual(withOrder?.order, ["together"])
		assert.equal(sortIsOverridden({ order: ["together"] }), true)
		assert.equal(sortIsOverridden({ order: [" "] }), false)
		assert.equal(sortIsOverridden({}), false)
	})

	it("names the seller a ceiling would quietly exclude", () => {
		const live = { together: { input: 0.6, output: 0.9 }, deepinfra: { input: 0.2, output: 0.3 } }
		assert.deepEqual(sellersAboveCeiling({ order: ["together", "deepinfra"], maxInputPrice: 0.5 }, live), ["together"])
		assert.deepEqual(sellersAboveCeiling({ order: ["together"], maxOutputPrice: 1.0 }, live), [])
		assert.deepEqual(sellersAboveCeiling({ order: ["unknown-seller"], maxInputPrice: 0.01 }, live), [])
		assert.deepEqual(sellersAboveCeiling({ order: ["together"] }, live), [], "no ceiling excludes nobody")
	})
})

describe("routing — the advanced field", () => {
	it("is merged last, so a new vendor field needs no release", () => {
		const merged = mergeAdvancedBody(
			{ temperature: 0.2 } as Record<string, unknown>,
			'{"reasoning_effort":"high","temperature":0.7}',
		)
		assert.equal(merged.reasoning_effort, "high")
		assert.equal(merged.temperature, 0.7, "the developer's own value wins over ours")
	})

	it("can never change WHAT is asked or of whom", () => {
		const merged = mergeAdvancedBody(
			{ model: "ours", messages: [{ role: "user" }], stream: true } as Record<string, unknown>,
			'{"model":"theirs","messages":[],"stream":false,"stream_options":{"include_usage":false},"top_k":5}',
		)
		assert.equal(merged.model, "ours")
		assert.deepEqual(merged.messages, [{ role: "user" }])
		assert.equal(merged.stream, true)
		assert.deepEqual(merged.stream_options, undefined)
		assert.equal(merged.top_k, 5)
	})

	it("ignores a half-typed field rather than breaking the run", () => {
		assert.deepEqual(mergeAdvancedBody({ a: 1 }, '{"reasoning'), { a: 1 })
		assert.deepEqual(mergeAdvancedBody({ a: 1 }, "   "), { a: 1 })
		assert.deepEqual(mergeAdvancedBody({ a: 1 }, "[1,2]"), { a: 1 })
	})
})
