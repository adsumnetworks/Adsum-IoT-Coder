import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { foldEspBuildLog, foldEspBuildResult } from "./espBuildFold"

/**
 * Fold of verbose `idf.py build` logs before they enter context (from 2906j: two full builds + report rewrites
 * overran the 200K window). Keep head + error/warning lines + tail; drop the compiler-noise middle.
 */
describe("espBuildFold — foldEspBuildLog", () => {
	test("leaves a short log untouched", () => {
		const short = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")
		assert.equal(foldEspBuildLog(short), short)
	})

	test("folds a long log to head + tail + a marker, dropping the middle", () => {
		const lines = Array.from({ length: 400 }, (_, i) => `[${i}/400] Compiling foo_${i}.c`)
		lines.push("Project build complete. To flash, run: idf.py flash")
		const folded = foldEspBuildLog(lines.join("\n"))
		const out = folded.split("\n")
		assert.ok(out.length < 200, `folded should be far smaller, got ${out.length}`)
		assert.ok(folded.includes("[0/400]"), "keeps head")
		assert.ok(folded.includes("Project build complete"), "keeps the tail (build result)")
		assert.match(folded, /build lines folded/, "has the fold marker")
	})

	test("never folds away a failure — error/warning lines from the middle are preserved", () => {
		const lines = Array.from({ length: 300 }, (_, i) => `[${i}] Compiling x_${i}.c`)
		lines.splice(150, 0, "main.c:42:5: error: 'foo' undeclared (first use in this function)")
		lines.push("ninja: build stopped: subcommand failed.")
		const folded = foldEspBuildLog(lines.join("\n"))
		assert.ok(folded.includes("error: 'foo' undeclared"), "the mid-log error survives the fold")
		assert.ok(folded.includes("ninja: build stopped"), "keeps the failure tail")
	})
})

describe("espBuildFold — foldEspBuildResult", () => {
	test("folds a string result", () => {
		const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
		assert.ok((foldEspBuildResult(big) as string).length < big.length)
	})

	test("folds the text of content blocks, leaves non-text blocks intact", () => {
		const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
		const res = foldEspBuildResult([{ type: "text", text: big } as never, { type: "image", source: {} } as never]) as Array<{
			type: string
			text?: string
		}>
		assert.ok(res[0].text!.length < big.length, "text block folded")
		assert.equal(res[1].type, "image", "image block untouched")
	})
})
