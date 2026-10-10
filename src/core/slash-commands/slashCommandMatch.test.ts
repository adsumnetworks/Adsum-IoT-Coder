import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { findSlashCommandMatch } from "./slashCommandMatch"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/slash-commands/slashCommandMatch.test.ts
 */
describe("findSlashCommandMatch — a /command token anywhere in the message", () => {
	test("at the start", () => {
		const match = findSlashCommandMatch("/newtask please pick this up")
		assert.ok(match)
		assert.equal(match[2], "newtask")
		assert.equal(match.index, 0)
	})

	test("in the middle", () => {
		const match = findSlashCommandMatch("could you run /compact and carry on")
		assert.ok(match)
		assert.equal(match[2], "compact")
	})

	test("at the end", () => {
		const match = findSlashCommandMatch("wrap this task up with /newtask")
		assert.ok(match)
		assert.equal(match[2], "newtask")
	})

	test("inside a fenced code block is ignored", () => {
		const text = "here is an example:\n```\n/newtask\n```\nplain text after"
		assert.equal(findSlashCommandMatch(text), null)
	})

	test("a command outside the fence is still found even when one sits inside it", () => {
		const text = "```\n/newtask\n```\nnow for real, /compact please"
		const match = findSlashCommandMatch(text)
		assert.ok(match)
		assert.equal(match[2], "compact")
	})

	test("a serial port path is not a command", () => {
		assert.equal(findSlashCommandMatch("flash it over /dev/ttyACM3 please"), null)
	})

	test("a source path is not a command", () => {
		assert.equal(findSlashCommandMatch("the bug is in src/foo not here"), null)
	})

	test("a URL is not a command", () => {
		assert.equal(findSlashCommandMatch("see http://example.com/newtask for details"), null)
	})

	test("two commands: the first one found wins", () => {
		const match = findSlashCommandMatch("/newtask then /compact")
		assert.ok(match)
		assert.equal(match[2], "newtask")
	})
})
