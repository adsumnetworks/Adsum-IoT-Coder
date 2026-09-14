import { strict as assert } from "node:assert"
import { parseRoutingTestPayload, ROUTING_TEST_FIELDS, shouldRegisterRoutingTestAid } from "../routingTestAid"

/**
 * A test aid that could reach a customer would be a defect, and one that writes a field nobody asked
 * for would be worse than typing by hand. These are the three rules that keep it honest.
 */
describe("the routing test aid", () => {
	it("exists only in a development build", () => {
		assert.equal(shouldRegisterRoutingTestAid("true"), true)
		assert.equal(shouldRegisterRoutingTestAid("false"), false)
		assert.equal(shouldRegisterRoutingTestAid(undefined), false)
		assert.equal(shouldRegisterRoutingTestAid(""), false)
		assert.equal(shouldRegisterRoutingTestAid("TRUE"), false, "the flag is the literal string, not a truthy value")
	})

	it("writes only the fields it was given", () => {
		const parsed = parseRoutingTestPayload(
			'{"openRouterModelId":"deepseek/deepseek-v4-flash-0731","openRouterSellerOrder":"baidu, baseten, parasail","openRouterOnlyTheseSellers":true}',
		)
		assert.equal(parsed.ok, true)
		assert.deepEqual(parsed.ok && parsed.fields, {
			openRouterModelId: "deepseek/deepseek-v4-flash-0731",
			openRouterSellerOrder: "baidu, baseten, parasail",
			openRouterOnlyTheseSellers: true,
		})
	})

	it("refuses an unknown field rather than storing it, and names it", () => {
		const parsed = parseRoutingTestPayload('{"openRouterSellerOrder":"baidu","apiKey":"sk-whatever"}')
		assert.equal(parsed.ok, false)
		assert.match(parsed.ok === false ? parsed.reason : "", /unknown field "apiKey"/)
		// Nothing is partially applied: a refusal writes nothing at all.
		assert.equal("fields" in parsed, false)
	})

	it("refuses anything that is not a JSON object of strings and booleans", () => {
		assert.equal(parseRoutingTestPayload("not json").ok, false)
		assert.equal(parseRoutingTestPayload("[1,2]").ok, false)
		assert.equal(parseRoutingTestPayload("{}").ok, false)
		assert.equal(parseRoutingTestPayload('{"openRouterMaxInputPrice":0.15}').ok, false, "prices are typed as strings")
	})

	it("covers exactly the routing fields and the model, and nothing else", () => {
		assert.deepEqual([...ROUTING_TEST_FIELDS].sort(), [
			"openRouterExtraBody",
			"openRouterMaxInputPrice",
			"openRouterMaxOutputPrice",
			"openRouterModelId",
			"openRouterOnlyTheseSellers",
			"openRouterProviderSorting",
			"openRouterRequireToolCalls",
			"openRouterSellerOrder",
		])
	})
})
