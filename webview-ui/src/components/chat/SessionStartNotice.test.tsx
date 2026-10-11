import type { ClineMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import SessionStartNotice, { sessionStartNotice } from "./SessionStartNotice"

/**
 * [0.5.1 bench] A session tab opened from a Hardware page button was a header and nothing else until the first
 * request started. One quiet line fills that gap, and only that gap: it goes with the first row, and a session
 * with a transcript never shows it.
 */
const task: ClineMessage = { type: "say", say: "task", ts: 1, text: "Read the logs of LBG20x AD50" }
const say = (s: ClineMessage["say"], over: Partial<ClineMessage> = {}): ClineMessage => ({ type: "say", say: s, ts: 2, ...over })
const ask = (a: ClineMessage["ask"], over: Partial<ClineMessage> = {}): ClineMessage => ({ type: "ask", ask: a, ts: 3, ...over })

describe("sessionStartNotice", () => {
	it("says nothing when there is no session", () => {
		expect(sessionStartNotice([])).toBeNull()
	})

	it("is starting while the first message is all there is", () => {
		expect(sessionStartNotice([task])).toBe("starting")
	})

	it("stays through bookkeeping the chat never draws", () => {
		expect(sessionStartNotice([task, say("task_progress", { text: "- [ ] read" })])).toBe("starting")
		expect(sessionStartNotice([task, say("text", { text: "" })])).toBe("starting")
	})

	it("goes as soon as the first request starts", () => {
		expect(sessionStartNotice([task, say("api_req_started", { text: "{}" })])).toBeNull()
	})

	it("goes for any other row: a reply, an error, a question", () => {
		expect(sessionStartNotice([task, say("text", { text: "Reading the passport." })])).toBeNull()
		expect(sessionStartNotice([task, say("error", { text: "no provider" })])).toBeNull()
		expect(sessionStartNotice([task, ask("followup", { text: "Which unit?" })])).toBeNull()
	})

	it("is stopped when the host asks to resume a session that never got a reply", () => {
		expect(sessionStartNotice([task, ask("resume_task")])).toBe("stopped")
		// Reopened more than once: several resume asks, still no row.
		expect(sessionStartNotice([task, ask("resume_task"), ask("resume_task", { ts: 4 })])).toBe("stopped")
	})

	it("never shows for a session with a transcript, resumed or finished", () => {
		const reply = say("text", { text: "It is an LBG20x, claimed." })
		expect(sessionStartNotice([task, say("api_req_started", { text: "{}" }), reply, ask("resume_task")])).toBeNull()
		expect(sessionStartNotice([task, say("api_req_started", { text: "{}" }), reply, ask("resume_completed_task")])).toBeNull()
		expect(
			sessionStartNotice([task, say("api_req_started", { text: "{}" }), ask("completion_result", { text: "Done." })]),
		).toBeNull()
	})

	it("has no words for an ask with no row above it that is not a resume", () => {
		expect(sessionStartNotice([task, ask("resume_completed_task")])).toBeNull()
		expect(sessionStartNotice([task, ask("api_req_failed", { text: "401" })])).toBeNull()
	})
})

describe("SessionStartNotice", () => {
	it("shows one quiet Starting… line under the first message of a session tab", () => {
		render(<SessionStartNotice messages={[task]} view="session" />)
		const line = screen.getByTestId("session-start-notice")
		expect(line).toHaveTextContent("Starting…")
		expect(line).toHaveAttribute("role", "status")
		expect(line).toHaveAttribute("data-state", "starting")
	})

	it("is gone once the first request has started", () => {
		const { container, rerender } = render(<SessionStartNotice messages={[task]} view="session" />)
		rerender(<SessionStartNotice messages={[task, say("api_req_started", { text: "{}" })]} view="session" />)
		expect(container).toBeEmptyDOMElement()
	})

	it("says a reopened session stopped before its first reply, and what sends it again", () => {
		render(<SessionStartNotice messages={[task, ask("resume_task")]} view="session" />)
		const line = screen.getByTestId("session-start-notice")
		expect(line).toHaveTextContent("This session stopped before the first reply. Press the send arrow to send it again.")
		expect(line.querySelector(".codicon-loading")).toBeNull()
	})

	it("never renders in the sidebar view", () => {
		const { container } = render(<SessionStartNotice messages={[task]} view="sidebar" />)
		expect(container).toBeEmptyDOMElement()
	})
})
