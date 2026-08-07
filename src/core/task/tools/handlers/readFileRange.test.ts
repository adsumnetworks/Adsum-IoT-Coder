import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { formatRangeHeader, sliceLineRange } from "./readFileRange"

/**
 * read_file's optional line window. The failure this prevents is measured: an agent read a
 * 69,739-char sdkconfig whole *after* search_files had already located the 570-char answer.
 * Every rule here is a "must never fail the read" rule — a malformed range degrades to the
 * whole file rather than returning a wrong slice.
 */
const FILE = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].join("\n")

describe("sliceLineRange", () => {
	test("returns the whole file byte-identical when both bounds are omitted", () => {
		const r = sliceLineRange(FILE)
		assert.equal(r.applied, false)
		assert.equal(r.text, FILE)
		assert.equal(r.total, 6)
	})

	test("a simple range is 1-based and inclusive on BOTH ends", () => {
		const r = sliceLineRange(FILE, 2, 4)
		assert.equal(r.applied, true)
		assert.equal(r.text, "bravo\ncharlie\ndelta")
		assert.deepEqual([r.start, r.end, r.total], [2, 4, 6])
	})

	test("a single-line range returns exactly that line", () => {
		assert.equal(sliceLineRange(FILE, 1, 1).text, "alpha")
		assert.equal(sliceLineRange(FILE, 6, 6).text, "foxtrot")
	})

	test("XML mode delivers strings — numeric strings parse the same as numbers", () => {
		assert.equal(sliceLineRange(FILE, "2", "4").text, sliceLineRange(FILE, 2, 4).text)
		assert.equal(sliceLineRange(FILE, " 3 ", " 3 ").text, "charlie")
	})

	test("clamps an end past EOF instead of erroring or padding", () => {
		const r = sliceLineRange(FILE, 5, 9999)
		assert.equal(r.text, "echo\nfoxtrot")
		assert.deepEqual([r.start, r.end], [5, 6])
	})

	test("clamps a start past EOF to the last line", () => {
		const r = sliceLineRange(FILE, 500, 900)
		assert.equal(r.text, "foxtrot")
		assert.deepEqual([r.start, r.end], [6, 6])
	})

	test("clamps zero and negative bounds up to line 1", () => {
		const r = sliceLineRange(FILE, 0, 2)
		assert.equal(r.text, "alpha\nbravo")
		assert.deepEqual([r.start, r.end], [1, 2])
		assert.equal(sliceLineRange(FILE, -10, -3).text, "alpha")
	})

	test("swaps a reversed range rather than returning nothing", () => {
		const r = sliceLineRange(FILE, 5, 2)
		assert.equal(r.text, "bravo\ncharlie\ndelta\necho")
		assert.deepEqual([r.start, r.end], [2, 5])
	})

	test("only start → reads to EOF; only end → reads from line 1", () => {
		assert.equal(sliceLineRange(FILE, 4).text, "delta\necho\nfoxtrot")
		assert.equal(sliceLineRange(FILE, undefined, 2).text, "alpha\nbravo")
	})

	test("invalid strings are IGNORED (whole file), never coerced to 0", () => {
		for (const bad of ["", "   ", "abc", "12abc", "1.5", "NaN", "1e3"]) {
			const r = sliceLineRange(FILE, bad, bad)
			assert.equal(r.applied, false, `'${bad}' should be ignored`)
			assert.equal(r.text, FILE)
		}
	})

	test("one valid bound survives the other being garbage", () => {
		const r = sliceLineRange(FILE, "3", "not-a-number")
		assert.equal(r.applied, true)
		assert.equal(r.text, "charlie\ndelta\necho\nfoxtrot")
	})

	test("a trailing newline does not count as an extra line", () => {
		const r = sliceLineRange("one\ntwo\nthree\n", 1, 99)
		assert.equal(r.total, 3)
		assert.equal(r.text, "one\ntwo\nthree")
	})

	test("empty and single-line files never produce an out-of-range slice", () => {
		assert.equal(sliceLineRange("", 1, 50).text, "")
		assert.equal(sliceLineRange("solo", 4, 9).text, "solo")
	})

	test("CRLF content keeps its carriage returns inside the window", () => {
		const r = sliceLineRange("a\r\nb\r\nc", 2, 2)
		assert.equal(r.text, "b\r")
	})

	test("the annotation states the range, the total, and the path", () => {
		assert.equal(
			formatRangeHeader(sliceLineRange(FILE, 2, 4), "build/zephyr/.config"),
			"[Lines 2-4 of 6 — build/zephyr/.config]",
		)
	})

	test("the sdkconfig case: a 2,000-line config yields only the requested window", () => {
		const sdkconfig = Array.from({ length: 2_000 }, (_, i) => `CONFIG_OPT_${i}=y`).join("\n")
		const r = sliceLineRange(sdkconfig, "1180", "1195")
		assert.equal(r.text.split("\n").length, 16)
		assert.ok(r.text.startsWith("CONFIG_OPT_1179="), "1-based: line 1180 is index 1179")
		assert.ok(r.text.length < 600, `window must be tiny next to the whole file (got ${r.text.length})`)
	})
})
