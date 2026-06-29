import { describe, expect, it } from "vitest"
import { isFreshNordicCompletion, isNordicTaskComplete, TASK_COMPLETE_MARKER } from "./nordicModes"

/**
 * R4 safety-net: the next-step menu must render when the Nordic task ends — whether the model emits the
 * loop-exit marker OR completes via attempt_completion (completion_result). The latter is the case a real CRA
 * run kept hitting (premature attempt_completion with no marker → the menu never showed).
 */
describe("isNordicTaskComplete", () => {
	it("fires on a text message carrying the completion marker", () => {
		expect(isNordicTaskComplete({ type: "say", say: "text", text: `All done.\n${TASK_COMPLETE_MARKER}` })).toBe(true)
	})

	it("fires on an attempt_completion result (say completion_result), marker or not", () => {
		expect(isNordicTaskComplete({ type: "say", say: "completion_result", text: "The CRA SBOM & Fix is complete." })).toBe(
			true,
		)
	})

	it("fires on the follow-up completion_result ask", () => {
		expect(isNordicTaskComplete({ type: "ask", ask: "completion_result", text: "" })).toBe(true)
	})

	it("does NOT fire on an ordinary text message without the marker", () => {
		expect(isNordicTaskComplete({ type: "say", say: "text", text: "Here is your SBOM." })).toBe(false)
	})

	it("does NOT fire when the marker is QUOTED mid-text (workflow echo), only when it ENDS the message", () => {
		// The cra-readiness workflow file literally says "emit `<!--TASK_COMPLETE-->` (exactly — nothing after
		// it)". A model that reads + paraphrases the workflow drops the marker into narration with text after it;
		// that must NOT be read as completion (it latched the next-step menu over a still-running run).
		expect(
			isNordicTaskComplete({
				type: "say",
				say: "text",
				text: `I'll follow the workflow and end with ${TASK_COMPLETE_MARKER} exactly, nothing after it.`,
			}),
		).toBe(false)
		// Trailing whitespace after the marker is still a valid completion.
		expect(isNordicTaskComplete({ type: "say", say: "text", text: `Done.\n${TASK_COMPLETE_MARKER}\n  ` })).toBe(true)
	})

	it("does NOT fire while a message is still streaming (partial)", () => {
		expect(isNordicTaskComplete({ type: "say", say: "completion_result", text: "in progress", partial: true })).toBe(false)
	})

	it("does NOT fire on a tool/ask message that is not a completion", () => {
		expect(isNordicTaskComplete({ type: "ask", ask: "followup", text: "Which gap next?" })).toBe(false)
	})

	it("is safe on null / undefined", () => {
		expect(isNordicTaskComplete(undefined)).toBe(false)
		expect(isNordicTaskComplete(null)).toBe(false)
	})
})

/**
 * F3 regression: clicking a next-step card flips the phase back to "active", but the last chat message is still
 * the PREVIOUS completion until the new turn streams. The latch must NOT re-fire on that already-consumed
 * completion (which pinned the chooser as a footer that got shoved down + hid the input bar). isFreshNordicCompletion
 * gates on a new completion ts vs the one already latched.
 */
describe("isFreshNordicCompletion", () => {
	const completion = (ts: number) => ({ type: "say", say: "completion_result", text: "done", ts })

	it("fires on the FIRST completion (nothing latched yet)", () => {
		expect(isFreshNordicCompletion(completion(100), undefined)).toBe(true)
	})

	it("does NOT re-fire on the already-consumed completion (the card-click race)", () => {
		// Same completion (ts 100) we already latched → must be ignored when phase briefly goes active on a card click.
		expect(isFreshNordicCompletion(completion(100), 100)).toBe(false)
	})

	it("fires again on a genuinely NEW completion after one was consumed", () => {
		expect(isFreshNordicCompletion(completion(200), 100)).toBe(true)
	})

	it("does NOT fire on a non-completion message even if its ts is new", () => {
		expect(isFreshNordicCompletion({ type: "say", say: "text", text: "still working", ts: 300 }, 100)).toBe(false)
	})

	it("does NOT fire on a completion-marker text that is merely QUOTED mid-message", () => {
		expect(
			isFreshNordicCompletion(
				{ type: "say", say: "text", text: `end with ${TASK_COMPLETE_MARKER} exactly, nothing after`, ts: 400 },
				100,
			),
		).toBe(false)
	})

	it("is safe on null / undefined / missing ts", () => {
		expect(isFreshNordicCompletion(undefined, 100)).toBe(false)
		expect(isFreshNordicCompletion(null, 100)).toBe(false)
		expect(isFreshNordicCompletion({ type: "say", say: "completion_result", text: "done" }, 100)).toBe(false)
	})
})
