import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { findJourneyStep } from "../journeyStep"

const text = (s: string, ts = 1): ClineMessage => ({ ts, type: "say", say: "text", text: s })

describe("findJourneyStep", () => {
	it("reads a step heading from the latest assistant text", () => {
		const messages = [text("### Step 3/7\n\nReading the manifest...", 1)]
		expect(findJourneyStep(messages)).toEqual({ step: 3, total: 7 })
	})

	it("is case-insensitive and tolerates spaces around the slash", () => {
		const messages = [text("## step 2 / 5", 1)]
		expect(findJourneyStep(messages)).toEqual({ step: 2, total: 5 })
	})

	it("returns undefined when the latest text has no heading", () => {
		const messages = [text("### Step 1/4", 1), text("Just a normal reply.", 2)]
		expect(findJourneyStep(messages)).toBeUndefined()
	})

	it("never reads a stale heading from an earlier turn", () => {
		const messages = [text("### Step 1/4", 1), text("### Step 2/4", 2), text("done for now", 3)]
		expect(findJourneyStep(messages)).toBeUndefined()
	})

	it("skips non-text rows (tool asks, say types other than text) to find the latest text", () => {
		const messages: ClineMessage[] = [
			text("### Step 5/6", 1),
			{ ts: 2, type: "ask", ask: "tool", text: "{}" },
			{ ts: 3, type: "say", say: "api_req_started", text: "{}" },
		]
		expect(findJourneyStep(messages)).toEqual({ step: 5, total: 6 })
	})

	it("returns undefined for an empty transcript", () => {
		expect(findJourneyStep([])).toBeUndefined()
	})
})
