import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { LoopDetector } from "./loopDetector"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/tools/loopDetector.test.ts
 */
describe("LoopDetector.observeCall — the same (tool, params) pair repeated", () => {
	test("no repeat: different params each time never triggers", () => {
		const detector = new LoopDetector()
		assert.equal(detector.observeCall("read_file", { path: "a.ts" }), null)
		assert.equal(detector.observeCall("read_file", { path: "b.ts" }), null)
		assert.equal(detector.observeCall("read_file", { path: "c.ts" }), null)
	})

	test("3 identical calls in a row trigger on the third", () => {
		const detector = new LoopDetector()
		assert.equal(detector.observeCall("execute_command", { command: "npm test" }), null)
		assert.equal(detector.observeCall("execute_command", { command: "npm test" }), null)
		const verdict = detector.observeCall("execute_command", { command: "npm test" })
		assert.ok(verdict)
		assert.equal(verdict.reason, "repeated-call")
		assert.equal(verdict.count, 3)
		assert.match(verdict.message, /execute_command/)
	})

	test("key order in params never defeats the match", () => {
		const detector = new LoopDetector()
		assert.equal(detector.observeCall("write_to_file", { path: "a.ts", content: "x" }), null)
		assert.equal(detector.observeCall("write_to_file", { content: "x", path: "a.ts" }), null)
		assert.ok(detector.observeCall("write_to_file", { path: "a.ts", content: "x" }))
	})

	test("interleaved different calls never trigger, even though one name repeats 3 times total", () => {
		const detector = new LoopDetector()
		assert.equal(detector.observeCall("read_file", { path: "a.ts" }), null)
		assert.equal(detector.observeCall("list_files", { path: "." }), null)
		assert.equal(detector.observeCall("read_file", { path: "a.ts" }), null)
		assert.equal(detector.observeCall("list_files", { path: "." }), null)
		assert.equal(detector.observeCall("read_file", { path: "a.ts" }), null)
	})

	test("a streak keeps climbing past the threshold if the model keeps repeating", () => {
		const detector = new LoopDetector()
		detector.observeCall("execute_command", { command: "npm test" })
		detector.observeCall("execute_command", { command: "npm test" })
		detector.observeCall("execute_command", { command: "npm test" })
		const verdict = detector.observeCall("execute_command", { command: "npm test" })
		assert.ok(verdict)
		assert.equal(verdict.count, 4)
	})
})

describe("LoopDetector.observeFailure — the same tool failing the same way", () => {
	test("fewer than 5 identical failures never trigger", () => {
		const detector = new LoopDetector()
		for (let i = 0; i < 4; i++) {
			assert.equal(detector.observeFailure("execute_command", "command not found: foo"), null)
		}
	})

	test("5 identical failures in a row trigger on the fifth", () => {
		const detector = new LoopDetector()
		assert.equal(detector.observeFailure("execute_command", "command not found: foo"), null)
		assert.equal(detector.observeFailure("execute_command", "command not found: foo"), null)
		assert.equal(detector.observeFailure("execute_command", "command not found: foo"), null)
		assert.equal(detector.observeFailure("execute_command", "command not found: foo"), null)
		const verdict = detector.observeFailure("execute_command", "command not found: foo")
		assert.ok(verdict)
		assert.equal(verdict.reason, "repeated-failure")
		assert.equal(verdict.count, 5)
		assert.match(verdict.message, /command not found: foo/)
	})

	test("a different error text resets the streak", () => {
		const detector = new LoopDetector()
		detector.observeFailure("execute_command", "error A")
		detector.observeFailure("execute_command", "error A")
		detector.observeFailure("execute_command", "error A")
		detector.observeFailure("execute_command", "error A")
		// different error — streak restarts at 1, not 5
		assert.equal(detector.observeFailure("execute_command", "error B"), null)
	})

	test("a success in between clears the failure streak", () => {
		const detector = new LoopDetector()
		detector.observeFailure("execute_command", "error A")
		detector.observeFailure("execute_command", "error A")
		detector.observeFailure("execute_command", "error A")
		detector.observeFailure("execute_command", "error A")
		detector.observeSuccess("execute_command")
		// would have been the 5th in a row without the success clearing it
		assert.equal(detector.observeFailure("execute_command", "error A"), null)
	})

	test("a different tool's failure streak is independent", () => {
		const detector = new LoopDetector()
		detector.observeFailure("execute_command", "boom")
		detector.observeFailure("execute_command", "boom")
		detector.observeFailure("execute_command", "boom")
		detector.observeFailure("execute_command", "boom")
		assert.equal(detector.observeFailure("read_file", "boom"), null)
	})
})
