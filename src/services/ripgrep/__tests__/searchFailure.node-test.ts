import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * A failed search must never look like a clean one.
 *
 * Measured across Omar's real sessions (2026-08-17): **326 of 377** `search_files` calls came back
 * "Found 0 results". Running ripgrep with the tool's own arguments against the same directories found
 * matches every time — 41, 76, 192, 636. The searches were not empty; they were failing.
 *
 * Two faults combined:
 *   1. execRipgrep rejected if ripgrep wrote ANYTHING to stderr. On Windows it routinely warns about
 *      unreadable files while searching everything else fine, so one skipped file discarded the search.
 *   2. The handler caught that and returned resultCount 0 with the error on console.error, so the model
 *      was told "Found 0 results" — which reads as "the file is clean".
 *
 * The model then read whole 800-line logs to check, which is the "it never uses search" complaint.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/ripgrep/__tests__/searchFailure.node-test.ts
 */

const RIPGREP = path.join(process.cwd(), "src", "services", "ripgrep", "index.ts")
const HANDLER = path.join(process.cwd(), "src", "core", "task", "tools", "handlers", "SearchFilesToolHandler.ts")

describe("ripgrep warnings do not destroy the search", () => {
	const src = fs.readFileSync(RIPGREP, "utf8")

	test("stderr alone no longer rejects", () => {
		assert.equal(
			/if \(errorOutput\) \{\s*reject\(/.test(src),
			false,
			"any-stderr-is-fatal was the bug: a permission warning threw away a valid search",
		)
	})

	test("the exit code decides, and 1 (no matches) is not a failure", () => {
		assert.ok(/exitCode !== null && exitCode >= 2/.test(src), "only exit >= 2 is a genuine ripgrep failure")
	})

	test("warnings are still surfaced to us, just not to the model", () => {
		assert.ok(
			/console\.warn\(`\[search_files\] ripgrep warnings/.test(src),
			"silently dropping them would hide real problems",
		)
	})
})

describe("a failed search says so", () => {
	const src = fs.readFileSync(HANDLER, "utf8")

	test("the catch returns an explicit failure message, not an empty result", () => {
		const cat = src.slice(src.indexOf("} catch (error) {"))
		assert.ok(/SEARCH FAILED/.test(cat), "the model must be told the search did not run")
		assert.ok(/NOT "no matches"/.test(cat), "the distinction is the whole point")
	})

	test("it forbids the exact wrong reaction — falling back to a whole-file read", () => {
		assert.ok(/Do NOT treat this as a clean result and do NOT fall back to reading the whole file/.test(src))
	})

	test("the reason reaches the model, not just console.error", () => {
		const cat = src.slice(src.indexOf("} catch (error) {"))
		assert.ok(/Reason: \$\{detail\}/.test(cat), "an invisible error is why this went unnoticed for so long")
	})
})

describe("the ripgrep binary is actually findable", () => {
	// ROOT CAUSE, found 2026-08-18 on Omar's bench. VS Code renamed the package to
	// `@vscode/ripgrep-universal` and moved the binary into a per-platform subfolder. The four hardcoded
	// paths all missed, getBinaryLocation threw on EVERY call, and the tool reported "Found 0 results".
	// In one Channel Sounding session that hid a log containing 299 distance measurements — the feature
	// under test had worked, and the agent was told the capture was empty.
	const src = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8")

	test("the renamed package is searched", () => {
		assert.ok(/ripgrep-universal/.test(src), "@vscode/ripgrep-universal is where VS Code keeps it now")
	})

	test("the per-platform subfolder is searched", () => {
		assert.ok(/\$\{process\.platform\}-\$\{process\.arch\}/.test(src), "bin/win32-x64/, not bin/")
	})

	test("Windows needs rg.exe, not rg", () => {
		assert.ok(/process\.platform === "win32"[\s\S]{0,80}\.exe/.test(src), "a bare 'rg' never matches on Windows")
	})

	test("older layouts still work — this must not break an older VS Code", () => {
		for (const legacy of ["node_modules/@vscode/ripgrep/bin/", "node_modules/vscode-ripgrep/bin"]) {
			assert.ok(src.includes(legacy), `dropped a still-valid path: ${legacy}`)
		}
	})

	test("when it cannot be found, the error says what that means", () => {
		assert.ok(/search_files cannot run at all/.test(src), "a bare 'not found' gave no clue why searches were empty")
	})
})

describe("a failed search survives aggregation", () => {
	const src = fs.readFileSync(
		path.join(process.cwd(), "src", "core", "task", "tools", "handlers", "SearchFilesToolHandler.ts"),
		"utf8",
	)

	test("failure is pushed through, not skipped", () => {
		// The second half of the bug: the catch produced a good message and the aggregator dropped it,
		// falling through to `allResults[0] || "Found 0 results."`.
		assert.ok(/if \(!success\) \{[\s\S]{0,200}allResults\.push/.test(src), "a failed workspace must contribute its message")
	})
})
