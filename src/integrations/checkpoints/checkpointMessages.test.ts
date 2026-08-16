import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * The checkpoint banner classifies by PHRASE, so the message text and the UI that reads it must not
 * drift apart. A message that matches nothing falls through to the red danger banner — which is how a
 * "still initializing" notice ends up looking like a broken extension.
 *
 * Reported 2026-08-16, on a real nRF54 project, mid-CRA-workflow:
 *   "Checkpoints are taking longer than expected to initialize. Working in a large repository?
 *    Consider re-opening Cline in a project that uses git, or  [Disable Checkpoints]"
 * — unbranded, and cut off mid-clause because the UI regex-stripped the final sentence to make a button.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/integrations/checkpoints/checkpointMessages.test.ts
 */

const ROOT = path.join(process.cwd(), "src", "integrations", "checkpoints")
const SOURCES = ["index.ts", "initializer.ts", "CheckpointUtils.ts", "CheckpointTracker.ts", "CheckpointGitOperations.ts"]

/** Source with comments removed — this checks what the DEVELOPER sees, and prose about the upstream
 *  project in a doc comment is not that. */
function readAll(): string {
	return SOURCES.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"))
		.join("\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "")
}

describe("checkpoint messages are branded", () => {
	test("no user-facing message tells the developer to re-open 'Cline'", () => {
		const src = readAll()
		// Internal Cline* identifiers are deliberately retained; only prose in quotes is checked.
		const offenders = [...src.matchAll(/"([^"]*\bCline\b[^"]*)"/g)]
			.map((m) => m[1])
			.filter((s) => /\s/.test(s) && !/^Cline[A-Z]/.test(s))
		assert.deepEqual(offenders, [], `unbranded user-facing text:\n${offenders.join("\n")}`)
	})
})

describe("every checkpoint message is classifiable by the banner", () => {
	// Mirrors webview-ui/src/components/chat/task-header/CheckpointError.tsx.
	const classify = (m: string): "working" | "inactive" | "error" => {
		if (m.includes("Git must be installed")) {
			return "error"
		}
		if (m.includes("still initializing")) {
			return "working"
		}
		if (
			m.includes("could not finish initializing") ||
			m.includes("checkpoints turn on by themselves") ||
			m.includes("multi-root workspaces") ||
			m.includes("off for this task")
		) {
			return "inactive"
		}
		return "error"
	}

	test("the slow-start notice reads as WORKING, never as an error", () => {
		const src = fs.readFileSync(path.join(ROOT, "index.ts"), "utf8")
		assert.ok(src.includes("Checkpoints are still initializing"), "the 7s notice must use the 'still initializing' wording")
		assert.equal(classify("Checkpoints are still initializing. This project is large, so the first snapshot"), "working")
	})

	test("the timeout notice reads as INACTIVE — stated once, with a way to settings", () => {
		assert.equal(
			classify("Checkpoints could not finish initializing for this project, so they are off for this task."),
			"inactive",
		)
	})

	test("a folder where checkpoints do not apply is INACTIVE, not a failure", () => {
		assert.equal(classify("Open a project folder and checkpoints turn on by themselves."), "inactive")
	})

	test("a genuine git failure stays an ERROR", () => {
		assert.equal(classify("Git must be installed to use checkpoints."), "error")
	})

	test("no message ends mid-clause with a dangling conjunction", () => {
		const src = readAll()
		const dangling = [...src.matchAll(/"([^"\n]{20,})"/g)]
			.map((m) => m[1])
			.filter((s) => /\b(or|and|,)\s*$/.test(s) && s.includes("heckpoint"))
		assert.deepEqual(dangling, [], `message ends mid-clause:\n${dangling.join("\n")}`)
	})
})
