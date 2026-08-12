import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { checkContextWindowExceededError } from "./context-error-handling"

/**
 * Recognising an overflow is what makes the session survivable: it is the signal that triggers
 * `handleContextWindowExceededError()` in Task, which truncates and retries. Miss it and the extension
 * re-sends the same oversized prompt until the retry budget runs out.
 *
 * The z.ai payloads below are copied verbatim from a real failed session (2026-08-12, glm-5-turbo):
 * 5 of these errors, 0 compactions, task abandoned.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/context/context-management/contextErrorDetection.test.ts
 */

describe("z.ai / GLM overflow is recognised", () => {
	test("the exact error from the failed session", () => {
		const err = {
			message: "400 Prompt exceeds max length",
			status: 400,
			code: "1261",
			modelId: "glm-5-turbo",
			providerId: "zai-coding-plan",
			details: { code: "1261", message: "Prompt exceeds max length" },
		}
		assert.equal(checkContextWindowExceededError(err), true)
	})

	test("the documented code alone is enough, whatever the wording", () => {
		assert.equal(checkContextWindowExceededError({ code: "1261", message: "some future rewording" }), true)
		assert.equal(checkContextWindowExceededError({ details: { code: "1261" }, message: "" }), true)
	})

	test("phrasing fallback, when only the message survives", () => {
		assert.equal(checkContextWindowExceededError({ status: 400, message: "Prompt exceeds max length" }), true)
		assert.equal(checkContextWindowExceededError({ status: 400, message: "prompt is too long" }), true)
	})

	test("a nested/serialised shape still matches", () => {
		assert.equal(checkContextWindowExceededError({ error: { code: "1261", message: "Prompt exceeds max length" } }), true)
	})
})

describe("unrelated failures must NOT be treated as overflow", () => {
	// A false positive silently truncates the user's conversation over an unrelated error — worse than
	// the bug being fixed, so these matter as much as the positives.
	const notOverflow = [
		{ status: 401, message: "Unauthorized", code: "1001" },
		{ status: 429, message: "Rate limit exceeded" },
		{ status: 400, message: "Invalid model id" },
		{ status: 400, message: "max_tokens must be a positive integer" },
		{ status: 500, message: "internal server error" },
		{ message: "Connection error." },
		{ status: 400, message: "content exceeds max length for a single message field" },
	]
	for (const err of notOverflow) {
		test(`ignores: ${err.message}`, () => {
			assert.equal(checkContextWindowExceededError(err), false)
		})
	}

	test("never throws on junk input", () => {
		for (const junk of [null, undefined, "", 42, {}, { message: null }, [], new Error("boom")]) {
			assert.doesNotThrow(() => checkContextWindowExceededError(junk as never))
		}
	})
})

describe("existing provider detections still work", () => {
	test("OpenAI/OpenRouter-style context length error", () => {
		assert.equal(
			checkContextWindowExceededError({ status: 400, message: "This model's maximum context length is 128000 tokens" }),
			true,
		)
	})
	test("token-exceed phrasing", () => {
		assert.equal(checkContextWindowExceededError({ status: 400, message: "input tokens exceed the configured limit" }), true)
	})
})
