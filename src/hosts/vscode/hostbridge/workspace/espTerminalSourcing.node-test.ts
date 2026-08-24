import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * "You are switching terminal, you source a one and u used other." — reported 2026-08-24, and exactly
 * what was happening.
 *
 * Two different notions of "our ESP terminal" were in play:
 *   - `prepareEspTerminal()` found one by NAME alone and tracked sourcing against that object.
 *   - the command then ran through `executeCommandTool(..., terminalName, ...)`, which resolves via
 *     `getOrCreateTerminal(cwd, name)` — by cwd AND name.
 *
 * A command issued from a different cwd therefore landed in a terminal that had never sourced the IDF
 * env, while the sourced flag sat on the first one. The transcript signature is distinctive: `build`
 * succeeds and prints "Activating ESP-IDF", `flash` fails with "idf.py is not recognized" and NO banner,
 * and from then on even `execute` fails — because the first terminal is marked sourced, so every later
 * command runs bare.
 *
 * These are source-shape assertions: the real behaviour needs a VS Code window, and the bug was never
 * about the sourcing logic itself — it was about two functions disagreeing on which terminal they meant.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/hosts/vscode/hostbridge/workspace/espTerminalSourcing.node-test.ts
 */

const ESP = path.join(process.cwd(), "src", "hosts", "vscode", "hostbridge", "workspace", "executeEspCommand.ts")
const HANDLER = path.join(process.cwd(), "src", "core", "task", "tools", "handlers", "TriggerEspActionHandler.ts")

describe("sourcing state is keyed the way the executor resolves terminals", () => {
	const esp = fs.readFileSync(ESP, "utf8")

	test("the set is keyed by a string, not a terminal reference", () => {
		// A Terminal object identifies the one found by name. The executor may pick a different one for a
		// different cwd, so an object key can never describe where the command actually ran.
		assert.ok(/const sourcedTerminals = new Set<string>\(\)/.test(esp), "must be keyed by (cwd, name), not by object")
		assert.equal(/new Set<vscode\.Terminal>\(\)/.test(esp), false, "the object-keyed set was the bug")
	})

	test("the key combines cwd and the terminal name", () => {
		const fn = esp.slice(esp.indexOf("function sourceKey"))
		assert.ok(/\$\{cwd \?\? ""\}::\$\{ESP_TERMINAL_NAME\}/.test(fn), "must match getOrCreateTerminal(cwd, name)")
	})

	test("both entry points take the cwd", () => {
		assert.ok(/export async function prepareEspTerminal\(cwd\?: string\)/.test(esp))
		assert.ok(/export function markEspTerminalSourced\(cwd\?: string\)/.test(esp))
	})
})

describe("the handler passes the same cwd it executes with", () => {
	const handler = fs.readFileSync(HANDLER, "utf8")

	test("prepare is given the cwd", () => {
		assert.ok(/prepareEspTerminal\(config\.cwd\)/.test(handler), "without this the two disagree again")
	})

	test("the sourced mark is recorded against that same cwd", () => {
		// Marking the terminal OBJECT is what left a never-sourced terminal running bare commands.
		assert.ok(/markEspTerminalSourced\(config\.cwd\)/.test(handler))
		assert.equal(/markEspTerminalSourced\(prepared\.terminal\)/.test(handler), false)
	})

	test("the command still executes by name, so the key must include cwd", () => {
		// This is the constraint the key exists to satisfy — if this ever stops passing terminalName,
		// revisit sourceKey rather than assuming it still lines up.
		assert.ok(/executeCommandTool\(\s*built\.command,\s*undefined,\s*prepared\.terminalName/.test(handler))
	})
})

describe("a closed terminal invalidates every cwd that used it", () => {
	const esp = fs.readFileSync(ESP, "utf8")

	test("closing ours clears the whole set", () => {
		// One terminal serves every cwd under that name. Deleting a single key would leave the others
		// claiming "already sourced" against a shell that no longer exists — bare commands again.
		const fn = esp.slice(esp.indexOf("function ensureCloseListener"), esp.indexOf("export function hostPlatform"))
		assert.ok(/sourcedTerminals\.clear\(\)/.test(fn))
		assert.ok(/t\.name === ESP_TERMINAL_NAME/.test(fn), "only OUR terminal closing should invalidate")
	})
})
