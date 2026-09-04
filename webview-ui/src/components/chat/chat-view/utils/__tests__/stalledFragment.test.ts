import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { filterVisibleMessages } from "../messageUtils"

/**
 * U-30, from the bench transcripts rather than from the name.
 *
 * `1788250767160` contains the case the operator saw: a provider took 113 s and returned the
 * single token `The`, the host rejected the turn for using no tool, and the retry answered
 * properly — leaving a bare `The` in the transcript with nothing to explain it.
 *
 * The cases that must SURVIVE matter more than the one that must go: across 46 bench tasks the
 * median rejected response is 757 characters of real reasoning, and hiding those would delete the
 * agent's own account of what it was doing.
 */

const say = (s: string, text: string): ClineMessage => ({ ts: 1, type: "say", say: s, text }) as ClineMessage
const RETRY = say("api_req_started", '{"request":"[ERROR] You did not use a tool in your previous response! Please retry"}')
const texts = (m: ClineMessage[]) =>
	filterVisibleMessages(m)
		.filter((x) => x.say === "text")
		.map((x) => x.text)

describe("a response that stalled and was rejected", () => {
	it("the bench's own case: a bare 'The' before a no-tool retry is debris", () => {
		expect(texts([say("text", "The"), say("checkpoint_created", ""), RETRY, say("text", "I need the overlay.")])).toEqual([
			"I need the overlay.",
		])
	})

	it("'READY' too — short, unfinished, and rejected", () => {
		expect(texts([say("text", "READY"), RETRY])).toEqual([])
	})
})

describe("what must never be hidden", () => {
	it("a real paragraph that merely forgot its tool call — the median case, 757 chars", () => {
		const prose = "The build succeeds (0x9e570 bytes) with the esp_netif action wired in, and the heap is unchanged."
		expect(texts([say("text", prose), RETRY])).toEqual([prose])
	})

	it("a short but COMPLETE answer, which a full stop proves", () => {
		const answer = 'You answered "LORA840XE-M2-V1".'
		expect(texts([say("text", answer), RETRY])).toEqual([answer])
	})

	it("a short line that was never rejected — no retry follows it", () => {
		expect(texts([say("text", "The"), say("checkpoint_created", ""), say("api_req_started", '{"request":"ok"}')])).toEqual([
			"The",
		])
	})

	it("a short line whose rejection belongs to a LATER turn, not to it", () => {
		// The first "The" is followed by a real tool call, so its turn was accepted; the rejection
		// three rows down is about the turn after it. Only adjacency (past checkpoints and
		// reasoning) may condemn a row — otherwise one rejection would erase the history above it.
		const far = [say("text", "The"), say("tool", "{}"), say("text", "Flashed and verified."), RETRY]
		expect(texts(far)).toEqual(["The", "Flashed and verified."])
	})
})
