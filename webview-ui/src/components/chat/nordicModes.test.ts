import { describe, expect, it } from "vitest"
import { isNordicTaskComplete, TASK_COMPLETE_MARKER } from "./nordicModes"

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
