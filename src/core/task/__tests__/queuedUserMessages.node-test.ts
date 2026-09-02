import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"
import { formatResponse } from "@core/prompts/responses"
import { USER_CONTENT_TAGS } from "@shared/messages/constants"

// `process.cwd()` rather than `__dirname`, matching the sibling source-pinning tests: both runners start
// at the repo root, and __dirname does not exist when mocha loads this as an ES module.
const REPO_ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8")

/**
 * Sending a message to a session that is already working.
 *
 * Two things here are worth a test rather than a comment, because both are silent when broken:
 *
 *  - The wrapper. If `<user_message>` were changed to a label of its own invention, @-mentions inside a
 *    message would stop expanding — loadContext only looks inside USER_CONTENT_TAGS — and a developer who
 *    typed a path would watch the agent read it as prose. That is what the seam's old `[note ...]` did.
 *  - The delivery point. A queued message must be drained at a turn boundary and nowhere else, and its
 *    transcript bubble must be written there too. Written any earlier it would be mistaken for the partial
 *    being streamed into, and would cancel any open ask by bumping lastMessageTs.
 */
describe("a message sent while the agent is working", () => {
	const taskSource = read("src/core/task/index.ts")

	describe("how it reads to the model", () => {
		const wrapped = formatResponse.queuedUserMessage("check the LED on the gateway")

		test("is wrapped in a tag loadContext will expand mentions inside", () => {
			// The whole reason this tag and not a label of our own: mention parsing is gated on this list.
			assert.ok(
				USER_CONTENT_TAGS.some((tag) => wrapped.includes(tag)),
				`the wrapper must use one of ${USER_CONTENT_TAGS.join(", ")} or @-mentions inside it go unexpanded`,
			)
			assert.match(wrapped, /<user_message>\ncheck the LED on the gateway\n<\/user_message>/)
		})

		test("carries the message verbatim, with nothing summarised or reworded", () => {
			assert.ok(wrapped.includes("check the LED on the gateway"))
		})

		test("says a person sent it, and says it arrived mid-turn", () => {
			// "a human told me this" must stay distinguishable from "I measured this" — the second is a
			// claim the agent can be held to.
			assert.match(wrapped, /sent a new message while you were working/)
			assert.match(wrapped, /Adsum IoT Coder/)
			assert.match(wrapped, /continue this turn/)
		})

		test("names the driver when the message came over the seam", () => {
			assert.match(formatResponse.queuedUserMessage("the antenna is fitted", "ismail-mac"), /^ismail-mac sent/)
			assert.match(formatResponse.queuedUserMessage("x"), /^The user sent/)
		})
	})

	describe("where it is delivered", () => {
		test("drained in exactly one place", () => {
			const drains = taskSource.match(/noteQueue\.drain\(\)/g) ?? []
			assert.equal(drains.length, 1, "draining in two places would deliver the same message twice")
		})

		test("drained at the top of the turn, before the request is assembled", () => {
			const turn = taskSource.slice(taskSource.indexOf("async recursivelyMakeClineRequests("))
			const drainAt = turn.indexOf("noteQueue.drain()")
			const apiReqAt = turn.indexOf('"api_req_started"')
			assert.ok(drainAt > -1, "the drain must live inside recursivelyMakeClineRequests")
			assert.ok(apiReqAt > -1)
			assert.ok(drainAt < apiReqAt, "a message drained after the request is assembled would miss this turn")
		})

		test("the transcript bubble is written at delivery, between the drain and the request", () => {
			const turn = taskSource.slice(taskSource.indexOf("async recursivelyMakeClineRequests("))
			const drainAt = turn.indexOf("noteQueue.drain()")
			const sayAt = turn.indexOf('this.say("user_feedback"', drainAt)
			const apiReqAt = turn.indexOf('"api_req_started"')
			assert.ok(sayAt > drainAt, "the bubble must be written at the delivery point, not at queue time")
			assert.ok(sayAt < apiReqAt)
		})

		test("delivered through the wrapper, never as bare text", () => {
			assert.match(taskSource, /formatResponse\.queuedUserMessage\(/)
		})
	})

	describe("what must never happen", () => {
		/**
		 * The bug this feature would otherwise have shipped. Nothing awaits an answer while the agent is
		 * working, so text written to the ask slot sits there until the next ask() — a tool or command
		 * approval — returns instantly with it, approving a tool the developer never saw. The webview had
		 * exactly this branch; it was unreachable only because the composer was disabled while running.
		 */
		test("queueUserMessage never touches the ask slot", () => {
			const start = taskSource.indexOf("async queueUserMessage(")
			assert.ok(start > -1, "queueUserMessage must exist on Task")
			const body = taskSource.slice(start, taskSource.indexOf("async removeQueuedUserMessage(", start))
			assert.doesNotMatch(body, /handleWebviewAskResponse/)
			assert.doesNotMatch(body, /askResponse\s*=/)
		})

		/**
		 * A message meant for a cancelled run must not be delivered to whatever task starts next — it would
		 * read as an instruction about work the new task knows nothing about.
		 */
		test("the queue is cleared when a task is aborted", () => {
			const abort = taskSource.slice(taskSource.indexOf("async abortTask()"))
			const clearAt = abort.indexOf("noteQueue.clear()")
			const abortFlagAt = abort.indexOf("this.taskState.abort = true")
			assert.ok(clearAt > -1, "abortTask must clear the queue")
			assert.ok(clearAt > abortFlagAt, "clear after the abort flag, so nothing can be queued into the gap")
		})
	})

	describe("telemetry", () => {
		test("reports counts and enums, never the message", () => {
			const service = read("src/services/telemetry/TelemetryService.ts")
			assert.match(service, /captureMessageQueued\(/)
			assert.match(service, /captureMessageDelivered\(/)
			assert.match(service, /captureMessageRemoved\(/)
			assert.match(taskSource, /telemetryService\.captureMessageQueued\(/)
			assert.match(taskSource, /telemetryService\.captureMessageDelivered\(/)

			// The message text is the developer's work and never leaves the machine.
			const queued = service.slice(service.indexOf("public captureMessageQueued("))
			const wrappers = queued.slice(0, queued.indexOf("public captureMessageRemoved(") + 200)
			assert.doesNotMatch(wrappers, /\btext\b/)
		})
	})
})
