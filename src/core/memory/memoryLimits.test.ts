import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { checkMemoryWriteSize, MEMORY_INJECT_CAP, MEMORY_WRITE_CAP, truncateMemoryForInjection } from "./memoryLimits"

/**
 * Project-memory size caps — the two guards that make the read-back safe to enable at all.
 * Without them an ever-growing session.md rides along in EVERY system prompt for the workspace
 * (the reason the injection sat commented out behind a TODO).
 * Run: npm run test:memory
 */

const ABS = "C:\\Users\\dev\\AppData\\Roaming\\Code\\User\\globalStorage\\iot-memory\\abc123\\session.md"

describe("checkMemoryWriteSize — the write cap", () => {
	test("content at or under the cap is accepted (null = no error)", () => {
		assert.equal(checkMemoryWriteSize("session.md", "short note"), null)
		assert.equal(checkMemoryWriteSize("session.md", "x".repeat(MEMORY_WRITE_CAP)), null)
		assert.equal(checkMemoryWriteSize("session.md", "x".repeat(MEMORY_WRITE_CAP - 1)), null)
	})

	test("one char over the cap is rejected", () => {
		const err = checkMemoryWriteSize("session.md", "x".repeat(MEMORY_WRITE_CAP + 1))
		assert.ok(err, "expected a rejection message")
	})

	test("the rejection names the file, both sizes, and tells the model to condense", () => {
		const err = checkMemoryWriteSize("project.md", "x".repeat(30000))
		assert.ok(err)
		assert.match(err, /project\.md/)
		assert.match(err, /30,000 chars/) // actual size, thousands-separated
		assert.match(err, /24,000-char limit/) // the cap
		assert.match(err, /condensed version/i) // actionable instruction, not just "too big"
	})

	test("the cap is the documented 24,000 chars", () => {
		assert.equal(MEMORY_WRITE_CAP, 24000)
	})
})

describe("truncateMemoryForInjection — the read-back cap", () => {
	test("small content passes through trimmed and unannotated", () => {
		assert.equal(truncateMemoryForInjection("\n\n# Session\n\nstate here\n\n", ABS), "# Session\n\nstate here")
		assert.doesNotMatch(truncateMemoryForInjection("# Session", ABS), /truncated/)
	})

	test("content exactly at the cap is not truncated", () => {
		const exact = "y".repeat(MEMORY_INJECT_CAP)
		assert.equal(truncateMemoryForInjection(exact, ABS), exact)
	})

	test("oversized content keeps the NEWEST tail (newest state is at the bottom)", () => {
		// oldest 1000 'A' then newest 6000 'B' — only the B's may survive.
		const content = "A".repeat(1000) + "B".repeat(MEMORY_INJECT_CAP)
		const out = truncateMemoryForInjection(content, ABS)
		const body = out.slice(out.indexOf("\n") + 1)
		assert.equal(body, "B".repeat(MEMORY_INJECT_CAP))
		assert.equal(body.length, MEMORY_INJECT_CAP)
		assert.ok(!body.includes("A"), "the oldest chars must be the ones dropped")
	})

	test("the truncation notice is the first line and states cap, real size, and absolute path", () => {
		const content = "z".repeat(7500)
		const out = truncateMemoryForInjection(content, ABS)
		const notice = out.split("\n")[0]
		assert.equal(notice, `(truncated: showing newest 6,000 of 7,500 chars — file at ${ABS})`)
		// The path matters most: the memory dir is an md5 of the cwd, so the model can never
		// derive it — without this line it cannot read_file the part that was cut.
		assert.ok(notice.includes(ABS))
	})

	test("the notice counts the TRIMMED length, so whitespace never inflates the reported size", () => {
		const out = truncateMemoryForInjection(`\n\n${"z".repeat(7500)}\n\n\n`, ABS)
		assert.match(out.split("\n")[0], /of 7,500 chars/)
	})

	test("the injection cap is the documented 6,000 chars and is well under the write cap", () => {
		assert.equal(MEMORY_INJECT_CAP, 6000)
		assert.ok(MEMORY_INJECT_CAP < MEMORY_WRITE_CAP)
	})

	test("a custom cap is honoured (the caps are parameters, not hardcoded in the formatter)", () => {
		const out = truncateMemoryForInjection("abcdefghij", "/tmp/session.md", 4)
		assert.equal(out, "(truncated: showing newest 4 of 10 chars — file at /tmp/session.md)\nghij")
	})
})
