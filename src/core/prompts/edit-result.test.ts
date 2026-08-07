import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
	CONTEXT_WINDOW_LINES,
	changedLineWindows,
	EDIT_APPLIED_SENTENCE,
	formatEditResult,
	NEW_FILE_ECHO_CHAR_CAP,
} from "./edit-result"

/**
 * Edit results must not echo the whole post-edit file back to the model.
 * (Measured: five replace_in_file edits to one 32 KB C file returned 158,580 chars in ~3 min.)
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/prompts/edit-result.test.ts
 */

const makeFile = (count: number, mutate?: (n: number) => string | undefined) =>
	Array.from({ length: count }, (_, i) => mutate?.(i + 1) ?? `line ${i + 1}`).join("\n") + "\n"

const ORIGINAL_200 = makeFile(200)
const FINAL_200 = makeFile(200, (n) => (n === 100 ? "line 100 CHANGED" : undefined))

describe("formatEditResult — existing file", () => {
	const result = formatEditResult({
		relPath: "main/main.c",
		absolutePath: "C:\\proj\\main\\main.c",
		fileExisted: true,
		originalContent: ORIGINAL_200,
		finalContent: FINAL_200,
		newProblemsMessage: "",
	})

	test("never echoes the full post-edit file", () => {
		assert.ok(!result.includes("<final_file_content"), "existing-file edits must not echo final_file_content")
		assert.ok(!result.includes(FINAL_200), "the whole file body must not appear")
		assert.ok(
			result.length < FINAL_200.length,
			`result (${result.length}) should be smaller than the file (${FINAL_200.length})`,
		)
	})

	test("returns a unified diff of what was applied", () => {
		assert.ok(result.includes('<applied_diff path="main/main.c">'))
		assert.ok(result.includes("-line 100"))
		assert.ok(result.includes("+line 100 CHANGED"))
	})

	test("returns a ±20-line numbered window around the change, and nothing beyond it", () => {
		assert.ok(result.includes('<changed_regions path="main/main.c" total_lines="200">'))
		assert.ok(result.includes("--- lines 80-120 of 200 ---"))
		assert.ok(/^\s*100 \| line 100 CHANGED$/m.test(result), "changed line must be shown with its line number")
		assert.ok(/^\s*80 \| line 80$/m.test(result), "window start must be included")
		assert.ok(!/\| line 79$/m.test(result), "lines outside the window must not be echoed")
		assert.ok(!/\| line 121$/m.test(result), "lines outside the window must not be echoed")
	})

	test("states the total line count, the absolute path and the trust sentence", () => {
		assert.ok(result.includes("The file is now 200 lines."))
		assert.ok(result.includes("C:\\proj\\main\\main.c"))
		assert.ok(result.includes(EDIT_APPLIED_SENTENCE))
	})

	test("CRLF-on-disk original vs LF-normalised save reports only the real change", () => {
		const crlfResult = formatEditResult({
			relPath: "main/main.c",
			fileExisted: true,
			originalContent: ORIGINAL_200.replace(/\n/g, "\r\n"),
			finalContent: FINAL_200,
		})
		const added = crlfResult.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))
		assert.equal(added.length, 1, `expected 1 added line, got ${added.length}`)
		assert.equal(added[0], "+line 100 CHANGED")
	})

	test("a no-op save says so instead of dumping the file", () => {
		const noop = formatEditResult({
			relPath: "a.c",
			fileExisted: true,
			originalContent: ORIGINAL_200,
			finalContent: ORIGINAL_200,
		})
		assert.ok(noop.includes("No net change"))
		assert.ok(!noop.includes("<final_file_content"))
	})

	test("auto-formatting is still surfaced (as a diff)", () => {
		const formatted = formatEditResult({
			relPath: "a.ts",
			fileExisted: true,
			originalContent: ORIGINAL_200,
			finalContent: FINAL_200,
			autoFormattingEdits: "@@ -1 +1 @@\n-const a = 'x'\n+const a = \"x\"",
		})
		assert.ok(formatted.includes("auto-formatting"))
		assert.ok(formatted.includes('+const a = "x"'))
	})
})

describe("formatEditResult — user edits in the diff view", () => {
	// User added a line of their own on top of the model's change before approving.
	const withUser = FINAL_200.replace("line 100 CHANGED", "line 100 CHANGED\nUSER_ADDED_LINE")
	const result = formatEditResult({
		relPath: "main/main.c",
		fileExisted: true,
		originalContent: ORIGINAL_200,
		finalContent: withUser,
		userEdits: "@@ -100 +100,2 @@\n line 100 CHANGED\n+USER_ADDED_LINE",
	})

	test("shows the user's delta", () => {
		assert.ok(result.includes('<user_edits path="main/main.c">'))
		assert.ok(result.includes("+USER_ADDED_LINE"))
		assert.ok(result.includes("do not re-apply"))
	})

	test("the net applied diff includes the user's line, without a full echo", () => {
		assert.ok(result.includes("<applied_diff"))
		assert.ok(/^\s*101 \| USER_ADDED_LINE$/m.test(result), "user's line appears in the numbered window")
		assert.ok(!result.includes("<final_file_content"))
		assert.ok(!result.includes(withUser))
	})
})

describe("formatEditResult — new files", () => {
	test("under the cap: content is echoed back", () => {
		const content = makeFile(20)
		const result = formatEditResult({
			relPath: "src/new.c",
			absolutePath: "/proj/src/new.c",
			fileExisted: false,
			finalContent: content,
		})
		assert.ok(content.length < NEW_FILE_ECHO_CHAR_CAP)
		assert.ok(result.includes('<final_file_content path="src/new.c">'))
		assert.ok(result.includes(content))
		assert.ok(result.includes("20 lines"))
	})

	test("over the cap: path + line/char count only, no content", () => {
		const big = makeFile(2000) // ~19 KB
		assert.ok(big.length > NEW_FILE_ECHO_CHAR_CAP)
		const result = formatEditResult({
			relPath: "src/big.c",
			absolutePath: "/proj/src/big.c",
			fileExisted: false,
			finalContent: big,
		})
		assert.ok(!result.includes("<final_file_content"))
		assert.ok(!result.includes(big))
		assert.ok(result.includes("/proj/src/big.c"))
		assert.ok(result.includes("2000 lines"))
		assert.ok(result.includes(`${big.length} characters`))
		assert.ok(result.length < 400)
	})
})

describe("changedLineWindows", () => {
	test("one hunk → one ±20 window clamped to the file", () => {
		assert.deepEqual(changedLineWindows(ORIGINAL_200, FINAL_200, CONTEXT_WINDOW_LINES), [{ start: 80, end: 120 }])
	})

	test("nearby hunks merge, distant hunks stay separate", () => {
		const final = makeFile(200, (n) => {
			if (n === 10) {
				return "line 10 CHANGED"
			}
			if (n === 30) {
				return "line 30 CHANGED"
			}
			if (n === 150) {
				return "line 150 CHANGED"
			}
			return undefined
		})
		assert.deepEqual(changedLineWindows(ORIGINAL_200, final), [
			{ start: 1, end: 50 },
			{ start: 130, end: 170 },
		])
	})

	test("pure deletion still yields a window", () => {
		const final = makeFile(200)
			.split("\n")
			.filter((l) => l !== "line 100")
			.join("\n")
		const windows = changedLineWindows(ORIGINAL_200, final)
		assert.equal(windows.length, 1)
		assert.ok(windows[0].start <= 100 && windows[0].end >= 100)
	})
})
