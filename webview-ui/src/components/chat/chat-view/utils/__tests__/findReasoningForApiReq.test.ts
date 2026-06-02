import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { findReasoningForApiReq } from "../messageUtils"

function msg(overrides: Partial<ClineMessage> & { ts: number }): ClineMessage {
	return { type: "say", say: "text", text: "", ...overrides } as ClineMessage
}

const API_TS = 1000

describe("findReasoningForApiReq", () => {
	it("returns empty result when api_req_started not found", () => {
		const result = findReasoningForApiReq(999, [msg({ ts: API_TS, say: "api_req_started" })])
		expect(result).toEqual({ reasoning: undefined, responseStarted: false, durationMs: undefined })
	})

	it("returns undefined reasoning when no reasoning messages follow", () => {
		const messages = [msg({ ts: API_TS, say: "api_req_started" }), msg({ ts: 2000, say: "text", text: "response" })]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.reasoning).toBeUndefined()
		expect(result.responseStarted).toBe(true)
	})

	it("collects reasoning content", () => {
		const messages = [
			msg({ ts: API_TS, say: "api_req_started" }),
			msg({ ts: 1100, say: "reasoning", text: "first thought" }),
			msg({ ts: 1200, say: "reasoning", text: "second thought" }),
			msg({ ts: 2000, say: "text", text: "response" }),
		]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.reasoning).toBe("first thought\n\nsecond thought")
	})

	it("computes durationMs as first response ts minus api_req ts", () => {
		const messages = [
			msg({ ts: API_TS, say: "api_req_started" }),
			msg({ ts: 1500, say: "reasoning", text: "thinking..." }),
			msg({ ts: 9000, say: "text", text: "response" }),
		]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.durationMs).toBe(9000 - API_TS) // 8000
		expect(result.responseStarted).toBe(true)
	})

	it("uses FIRST response message ts for duration, not later ones", () => {
		const messages = [
			msg({ ts: API_TS, say: "api_req_started" }),
			msg({ ts: 1500, say: "reasoning", text: "thinking..." }),
			msg({ ts: 5000, say: "text", text: "first response chunk" }),
			msg({ ts: 6000, say: "text", text: "second chunk" }),
		]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.durationMs).toBe(5000 - API_TS) // 4000, not 5000
	})

	it("returns durationMs undefined when response has not started", () => {
		const messages = [
			msg({ ts: API_TS, say: "api_req_started" }),
			msg({ ts: 1500, say: "reasoning", text: "still thinking..." }),
		]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.durationMs).toBeUndefined()
		expect(result.responseStarted).toBe(false)
	})

	it("stops collecting at the next api_req_started", () => {
		const messages = [
			msg({ ts: API_TS, say: "api_req_started" }),
			msg({ ts: 1500, say: "reasoning", text: "turn 1 thought" }),
			msg({ ts: 2000, say: "text", text: "turn 1 response" }),
			msg({ ts: 3000, say: "api_req_started" }),
			msg({ ts: 3500, say: "reasoning", text: "turn 2 thought" }),
		]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.reasoning).toBe("turn 1 thought")
		expect(result.durationMs).toBe(2000 - API_TS)
	})

	it("counts tool ask as a response start for durationMs", () => {
		const messages = [
			msg({ ts: API_TS, say: "api_req_started" }),
			msg({ ts: 1500, say: "reasoning", text: "thought" }),
			msg({ ts: 4000, type: "ask", ask: "tool", text: "{}" }),
		]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.responseStarted).toBe(true)
		expect(result.durationMs).toBe(4000 - API_TS)
	})

	it("reasoning-only (no response) returns responseStarted false and no durationMs", () => {
		const messages = [msg({ ts: API_TS, say: "api_req_started" }), msg({ ts: 1200, say: "reasoning", text: "thought" })]
		const result = findReasoningForApiReq(API_TS, messages)
		expect(result.reasoning).toBe("thought")
		expect(result.responseStarted).toBe(false)
		expect(result.durationMs).toBeUndefined()
	})
})
