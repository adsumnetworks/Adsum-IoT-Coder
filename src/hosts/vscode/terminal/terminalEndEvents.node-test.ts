import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { endEventDecision, isCompoundCommand } from "./terminalEndEvents"

const facts = (over: Partial<Parameters<typeof endEventDecision>[0]> = {}) => ({
	byRef: false,
	sameTerminal: true,
	sawOurStart: true,
	isCompound: false,
	...over,
})

describe("which end-of-command event is ours", () => {
	test("reference identity is the truth whenever it holds", () => {
		assert.deepEqual(endEventDecision(facts({ byRef: true })), { accept: true, why: "reference" })
		// Even for a compound command: this IS our execution object ending.
		assert.deepEqual(endEventDecision(facts({ byRef: true, isCompound: true })), { accept: true, why: "reference" })
	})

	/**
	 * 2026-08-24: the reference match failed (the object arrives as a different wrapper across the
	 * extension-host API) and the run hung until the sequence rule was added. That rule has to keep working.
	 */
	test("after our start, the next end on our terminal is ours even without reference identity", () => {
		assert.deepEqual(endEventDecision(facts()), { accept: true, why: "sequence" })
	})

	test("an end before our start belongs to the command before ours", () => {
		assert.deepEqual(endEventDecision(facts({ sawOurStart: false })), { accept: false, why: "stale" })
	})

	test("another terminal's end is never ours", () => {
		assert.deepEqual(endEventDecision(facts({ sameTerminal: false })), { accept: false, why: "other-terminal" })
	})

	/**
	 * THE COMPOUND INCIDENT, 2026-08-29. `echo "si 1" > f; echo …; JLinkExe …` produced a start for
	 * `echo "si 1"` and an end for it, and the sequence rule accepted that first end as the whole
	 * command's — so the run moved on while JLinkExe was still running.
	 */
	test("a sub-command's end does not complete a compound command", () => {
		assert.deepEqual(endEventDecision(facts({ isCompound: true })), { accept: false, why: "compound-subcommand" })
	})
})

describe("what counts as more than one command", () => {
	test("the shapes that make a shell run several things", () => {
		for (const cmd of [
			'echo "si 1" > /tmp/f.txt; JLinkExe -device X',
			"west build && west flash",
			"make || echo failed",
			"cat <<'EOF'\nbody\nEOF",
		]) {
			assert.ok(isCompoundCommand(cmd), cmd)
		}
	})

	test("an ordinary command is not compound, so it keeps the fast sequence path", () => {
		for (const cmd of [
			"grep -E 'CONFIG_(BT|NUS)' prj.conf",
			"west flash -d build --dev-id 001050924638",
			"ls -la /dev/bench/",
			'board-shell --port /dev/ttyACM4 --cmd "AT+CGDCONT?"',
		]) {
			assert.ok(!isCompoundCommand(cmd), cmd)
		}
	})

	/**
	 * A quoted separator reads as compound and that is the intended trade. Falling back to reference
	 * matching plus the silence backstop is slower and never wrong; accepting a sub-command's end
	 * truncates real output, which is how a working JLink probe was read as a hang.
	 */
	test("a quoted separator is treated as compound — the safe direction to be wrong in", () => {
		assert.ok(isCompoundCommand("echo 'a; b'"))
	})
})
