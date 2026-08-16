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

describe("checkpoint status is never stale", () => {
	const taskSrc = fs.readFileSync(path.join(process.cwd(), "src", "core", "task", "index.ts"), "utf8")
	const mgrSrc = fs.readFileSync(path.join(ROOT, "index.ts"), "utf8")

	test("a saved task does NOT restore its old checkpoint status", () => {
		// Reported twice on 2026-08-16, both after the condition had been resolved: a prototype kept
		// saying "checkpoints are off because this task is running in your Desktop" after the project was
		// opened, and an old task kept showing a previous build's wording after the extension was updated.
		// Status describes the machine and folder right now, so it must be re-derived, never replayed.
		assert.equal(
			/this\.taskState\.checkpointManagerErrorMessage\s*=\s*historyItem\.checkpointManagerErrorMessage/.test(taskSrc),
			false,
			"checkpoint status must not be restored from the history item",
		)
	})

	test("a successful initialization retracts the slow-start notice", () => {
		// The timer fires at 7s; the tracker can still arrive at 9s. Without an explicit retraction the
		// notice is permanent, and a working feature keeps explaining itself as though it were stuck.
		const success = mgrSrc.slice(mgrSrc.indexOf("this.state.checkpointTracker = tracker"))
		assert.ok(
			/checkpointsWarningShown[\s\S]{0,200}setcheckpointManagerErrorMessage\(undefined\)/.test(success),
			"success path must clear the message when the warning was shown",
		)
	})

	test("the timeout path does not string-match a phrase the message no longer contains", () => {
		assert.equal(
			mgrSrc.includes('errorMessage.includes("Checkpoints taking too long to initialize")'),
			false,
			"dead branch: pTimeout's message is already the developer-facing sentence",
		)
	})
})

describe("control flow never depends on message wording", () => {
	const mgrSrc = fs.readFileSync(path.join(ROOT, "index.ts"), "utf8")

	test("no branch tests the CONTENT of the status message", () => {
		// Rewording a sentence must never change behaviour. Two guards used to gate on the message
		// containing "Checkpoints initialization timed out."; rewording it in this same release turned
		// both into dead code, which would have left the extension re-attempting a 15s initialization on
		// exactly the large repositories where it had already timed out.
		const offenders = [...mgrSrc.matchAll(/checkpointManagerErrorMessage\?\.includes\("([^"]*)"\)/g)].map((m) => m[1])
		assert.deepEqual(offenders, [], `control flow keyed on prose:\n${offenders.join("\n")}`)
	})

	test("failed initialization sets the flag that stops further attempts", () => {
		assert.ok(
			/checkpointsUnavailableForTask = true/.test(mgrSrc),
			"the catch path must record that checkpoints are unavailable for this task",
		)
		assert.ok(
			/!this\.config\.enableCheckpoints \|\| this\.state\.checkpointsUnavailableForTask/.test(mgrSrc),
			"saveCheckpoint must gate on the flag",
		)
	})
})
