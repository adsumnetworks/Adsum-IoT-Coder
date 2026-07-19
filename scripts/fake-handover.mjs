#!/usr/bin/env node
/**
 * Step a fake handed-over session through its four states, so the agent strip can be seen and reviewed
 * without a real coding agent, a real board, or 40 minutes of waiting.
 *
 * It writes the same files the real thing writes (~/.adsum/handovers/<id>/), so the extension's own
 * tracker picks it up and the webview renders it exactly as it would in production — no mock mode, no
 * special-casing in the UI. Delete the directory (or press Ctrl-C then `--clean`) when done.
 *
 *   node scripts/fake-handover.mjs          # step through with ENTER between phases
 *   node scripts/fake-handover.mjs --auto   # advance every 6s
 *   node scripts/fake-handover.mjs --clean  # remove the fake handover
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"

const ID = "demo"
const ROOT = path.join(os.homedir(), ".adsum", "handovers")
const DIR = path.join(ROOT, ID)
const auto = process.argv.includes("--auto")

if (process.argv.includes("--clean")) {
	fs.rmSync(DIR, { recursive: true, force: true })
	console.log(`removed ${DIR}`)
	process.exit(0)
}

const now = () => new Date().toISOString()
const write = (f, v) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(v, null, 1))
const append = (f, v) => fs.appendFileSync(path.join(DIR, f), JSON.stringify({ t: now(), ...v }) + "\n")

const rl = auto ? null : readline.createInterface({ input: process.stdin, output: process.stdout })
const step = (label) =>
	new Promise((res) => {
		console.log(`\n▸ ${label}`)
		if (auto) {
			setTimeout(res, 6000)
		} else {
			rl.question("   press ENTER for the next phase… ", () => res())
		}
	})

fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(DIR, { recursive: true })

// ── phase 1: posted ──────────────────────────────────────────────────────────
write("brief.json", {
	createdAt: now(),
	workspace: process.cwd(),
	mission: "Test and validate softAP — host tests now, on-hardware checks when a board is connected.",
	governing: "adsum/esp/workflows/test-validate",
	steps: ["Step 1: Confirm scope gate", "Step 2: Survey what's actually runnable", "Step 4: Run the Unity suite"],
	baseline: { ref: "0123456789abcdef", managed: true },
	worklog: [],
	bits: [
		{
			id: "adsum/esp/workflows/test-validate",
			title: "Test & Validate Workflow",
			version: "1.2.0",
			author: "Omar Morceli",
			attributed: true,
			steward: "Adsum Networks",
			hop: 0,
			body: "# demo",
		},
		...Array.from({ length: 13 }, (_, i) => ({
			id: `adsum/esp/actions/demo-${i}`,
			title: `Action ${i}`,
			author: "Omar Morceli",
			attributed: true,
			hop: 1,
			body: "# demo",
		})),
	],
})
write("state.json", { status: "pending", createdAt: now() })
append("observations.jsonl", { event: "snapshot" })
console.log(`fake handover ${ID} → ${DIR}\n(the strip should now show "Posted")`)

await step("PICKED UP — the agent claimed it and is reading the workflow")
write("state.json", { status: "active", createdAt: now(), resumedAt: now() })
append("ledger.jsonl", { event: "resume", bits: 14, governing: "adsum/esp/workflows/test-validate", steps: 3 })

await step("WORKING — bit loaded, milestone reported, a command run through Adsum")
append("ledger.jsonl", {
	event: "kbit_load",
	id: "adsum/esp/workflows/test-validate",
	title: "Test & Validate Workflow",
	version: "1.2.0",
	author: "Omar Morceli",
})
append("ledger.jsonl", {
	event: "checkpoint",
	worklog: "Survey done — no suite, no board, macOS host",
	step: "Step 2: Survey what's actually runnable",
	tools_used: ["adsum.exec"],
})
append("ledger.jsonl", { event: "tool_exec", command: "idf.py --version", exit: 0 })

await step("WORKING — it edits source without building → the nudge fires, host sees the tree change")
append("ledger.jsonl", {
	event: "checkpoint",
	worklog: "Scaffolded test/, extracted pure logic to sta_table.h",
	step: "Step 4: Run the Unity suite",
	tools_used: ["own_terminal", "editor_tools"],
	files_touched: ["main/sta_table.h", "main/softap_example_main.c"],
})
append("observations.jsonl", { event: "tree_change", files: ["main/sta_table.h", "main/softap_example_main.c"] })
append("observations.jsonl", { event: "snapshot" })

await step("WORKING — it takes the nudge and builds")
append("ledger.jsonl", { event: "tool_build", command: "idf.py build", exit: 0 })

await step("CLOSED — the closing milestone, and the receipt")
append("ledger.jsonl", {
	event: "checkpoint",
	worklog: "Suite scaffolded and green — 6 cases, host tier",
	step: "Step 4: Run the Unity suite",
	tools_used: ["adsum.build"],
	files_touched: ["test/main/test_sta.c", "main/sta_table.h", "main/softap_example_main.c"],
	final: true,
	next_step: "Run the same suite on hardware when a board is connected",
})
append("observations.jsonl", { event: "diffstat", text: "3 files changed, 214 insertions(+), 9 deletions(-)" })
write("state.json", { status: "closed-by-agent", createdAt: now(), closedAt: now() })

console.log("\n✓ all four states shown. `node scripts/fake-handover.mjs --clean` removes it.")
rl?.close()
