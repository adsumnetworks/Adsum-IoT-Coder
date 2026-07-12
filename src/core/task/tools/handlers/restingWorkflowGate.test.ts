import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ToolUse } from "@core/assistant-message"
import { ClineDefaultTool } from "@shared/tools"
import { TaskState } from "../../TaskState"
import { AskFollowupQuestionToolHandler } from "./AskFollowupQuestionToolHandler"
import { AttemptCompletionHandler } from "./AttemptCompletionHandler"

/**
 * Proves the no-ending guard is GENERIC, not CRA-keyed: both handlers gate on
 * `TaskState.restingWorkflowActive` alone. These fakes flip ONLY that flag — never
 * `craReadinessReportWritten` / `craSbomEmitted` — so a pass here means a future non-CRA
 * workflow (nRF debug loop, ESP build loop, …) gets the same enforcement for free by
 * setting the one generic flag at its own write seam, with no fork of this guard logic.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/tools/handlers/restingWorkflowGate.test.ts
 */

function fakeBlock(params: Partial<Record<string, string>>): ToolUse {
	return {
		type: "tool_use",
		name: ClineDefaultTool.ATTEMPT,
		params: params as ToolUse["params"],
		partial: false,
	}
}

function fakeConfig(opts: { restingWorkflowActive: boolean; feedbackMessages?: Array<{ say: string; text: string }> }) {
	const taskState = new TaskState()
	taskState.restingWorkflowActive = opts.restingWorkflowActive
	const messages = (opts.feedbackMessages ?? []).map((m) => ({ type: "say", say: m.say, text: m.text }))
	return {
		taskState,
		cwd: "/tmp/resting-workflow-gate-test",
		messageState: {
			getClineMessages: () => messages,
		},
	} as any
}

describe("AttemptCompletionHandler — generic resting-workflow gate", () => {
	test("blocks attempt_completion when restingWorkflowActive is true, WITHOUT any CRA flag set", async () => {
		const handler = new AttemptCompletionHandler()
		const config = fakeConfig({ restingWorkflowActive: true })
		assert.equal(config.taskState.craReadinessReportWritten, false)
		assert.equal(config.taskState.craSbomEmitted, false)

		const result = await handler.execute(config, fakeBlock({ result: "Generic run summary, no CRA content." }))

		assert.ok(String(result).includes("no ending"), String(result))
	})

	test("does NOT block attempt_completion when restingWorkflowActive is false (normal workflow)", async () => {
		const handler = new AttemptCompletionHandler()
		const config = fakeConfig({ restingWorkflowActive: false })
		// A normal completion proceeds past the guard blocks into the say/ask flow, which these fakes don't
		// stub — reaching that far (a TypeError on the unstubbed callback) IS the proof the guard let it
		// through, vs. the guard's own toolError string short-circuiting first.
		await assert.rejects(() => handler.execute(config, fakeBlock({ result: "Plain task done." })))
	})

	test("explicit-end escape hatch still requires the NEXT_STEPS marker + rejects verdict leaks, generically", async () => {
		const handler = new AttemptCompletionHandler()
		const config = fakeConfig({
			restingWorkflowActive: true,
			feedbackMessages: [{ say: "user_feedback", text: "I'm done, wrap it up" }],
		})

		const verdictLeak = await handler.execute(config, fakeBlock({ result: "<!--NEXT_STEPS-->\n✅ All clean." }))
		assert.ok(String(verdictLeak).includes("verdict-style status"), String(verdictLeak))

		const missingMarker = await handler.execute(config, fakeBlock({ result: "Plain handoff text, no marker." }))
		assert.ok(String(missingMarker).includes("HANDOFF"), String(missingMarker))
	})
})

describe("AskFollowupQuestionToolHandler — generic resting-workflow gate", () => {
	test("rejects an exit-shaped option when restingWorkflowActive is true, WITHOUT any CRA flag set", async () => {
		const handler = new AskFollowupQuestionToolHandler()
		const config = fakeConfig({ restingWorkflowActive: true })
		assert.equal(config.taskState.craReadinessReportWritten, false)
		assert.equal(config.taskState.craSbomEmitted, false)

		const result = await handler.execute(
			config,
			fakeBlock({
				question: "Rebuild finished — what next?",
				options: JSON.stringify(["Rebuild with the next change", "I'll continue later"]),
			}),
		)

		assert.ok(String(result).includes("banned in a resting workflow"), String(result))
	})

	test("clean forward-only options pass the gate and reach the ask (generic, no CRA flags)", async () => {
		const handler = new AskFollowupQuestionToolHandler()
		const config = fakeConfig({ restingWorkflowActive: true })
		// Forward-only options clear the gate and fall through toward config.callbacks.ask, which this fake
		// doesn't stub — reaching that far (a TypeError, not a toolError string) IS the proof the gate passed.
		await assert.rejects(() =>
			handler.execute(
				config,
				fakeBlock({
					question: "Rebuild finished — what next?",
					options: JSON.stringify(["Rebuild with the next change", "Flash and re-check the log"]),
				}),
			),
		)
	})
})
