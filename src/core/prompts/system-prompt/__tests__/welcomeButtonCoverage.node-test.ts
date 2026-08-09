import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * The welcome buttons and the knowledge gate must agree.
 *
 * THE BUG THIS PINS (2026-08-08, tasks 1786200792898 and 1786200834425):
 *
 * With no folder open, the "Start a prototype" button falls back to the platform-agnostic prompt
 * because nothing can be detected:
 *
 *     "Start a new prototype — tell me whether it's nRF/Zephyr or ESP-IDF and what you're building..."
 *
 * The Scope Gate in AGENT.md recognised the prototype intent by LITERAL SUBSTRING, listing only
 * "scaffold a new nRF prototype" and "Start a new nRF/Zephyr prototype". The generic text matched
 * neither, so the scaffolding workflow never loaded and the agent fell into a clarification loop:
 * five turns, two "continue"s from the developer, zero files written. It reproduced identically on
 * every model, because it was never a model problem — our own button sent a phrase our own gate did
 * not recognise.
 *
 * This test is deliberately cross-boundary: the webview owns the button text, the knowledge corpus
 * owns the gate, and nothing else checks that they still line up.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/prompts/system-prompt/__tests__/welcomeButtonCoverage.node-test.ts
 */

// Resolve from the working directory, not __dirname: this file lives under a `__tests__/` folder that
// mocha also globs, and mocha loads it through the ESM loader where __dirname does not exist — using it
// took down the whole unit suite with "ReferenceError: __dirname is not defined in ES module scope".
// Both runners (npm run test:unit and the standalone ts-node script) execute from the repo root.
const REPO = process.cwd()
const INTENTS = path.join(REPO, "webview-ui/src/components/chat/welcome/welcomeIntents.ts")
const AGENT_MD = path.join(REPO, "iot-knowledge/AGENT.md")

const read = (p: string) => fs.readFileSync(p, "utf8")

/** The opening clause of every prototype prompt the welcome buttons can emit. */
function prototypeOpeners(src: string): string[] {
	// Each variant is a string literal returned from the "prototype" case.
	const caseStart = src.indexOf('case "prototype":')
	assert.ok(caseStart > 0, "welcomeIntents.ts must still have a prototype intent")
	const caseEnd = src.indexOf("case ", caseStart + 10)
	const body = src.slice(caseStart, caseEnd > 0 ? caseEnd : undefined)
	const openers: string[] = []
	for (const m of body.matchAll(/return\s+"([^"]+)"/g)) {
		// Take the text before the em-dash: the intent phrase, not the explanatory tail.
		openers.push(m[1].split("—")[0].trim())
	}
	return openers
}

describe("welcome buttons are recognised by the knowledge scope gate", () => {
	test("every prototype button phrase is covered by AGENT.md's trigger examples", () => {
		const openers = prototypeOpeners(read(INTENTS))
		assert.ok(openers.length >= 3, `expected the esp / both / nrf variants, got ${openers.length}`)

		// Normalise whitespace: markdown legitimately wraps a phrase across lines, and that must not
		// read as "missing" — only a genuinely absent phrase should fail this.
		const agent = read(AGENT_MD).replace(/\s+/g, " ")
		const missing = openers.filter((o) => !agent.includes(o.replace(/\s+/g, " ")))
		assert.deepEqual(
			missing,
			[],
			`AGENT.md does not list these welcome-button phrases as prototype triggers: ${JSON.stringify(missing)}. ` +
				`With no folder open the button emits the platform-agnostic phrase, so it MUST be covered.`,
		)
	})

	test("the platform-agnostic phrase specifically — the one that broke — is present", () => {
		assert.ok(
			read(AGENT_MD).includes("Start a new prototype"),
			"the no-folder-open button emits 'Start a new prototype ...' and the gate must recognise it",
		)
	})

	test("the gate matches on INTENT, not on literal phrasing", () => {
		// The real fix is not "add one more string" — it is that exact wording stopped being required.
		// If this regresses to substring matching, the next new button breaks the flow all over again.
		const agent = read(AGENT_MD).replace(/\s+/g, " ")
		assert.match(agent, /Recognize intent, not exact wording/i, "the gate must state that intent is what counts")
		assert.match(agent, /not a password the user has to type verbatim/i, "examples must be examples, not required phrasing")
	})

	test("a go-ahead must produce action, not another question", () => {
		// The developer said "continue" twice and got re-planned at instead of scaffolded.
		const agent = read(AGENT_MD)
		assert.match(agent, /go-ahead means act, not re-plan/i)
		assert.match(agent, /second consecutive clarifying question/i)
	})

	test("capture is forbidden until a build AND flash have succeeded", () => {
		// Capturing from a board that was never flashed with this firmware explains nothing.
		assert.match(read(AGENT_MD), /never (?:been )?flashed|Build \*\*and\*\* Flash|build AND flash/i)
	})
})
