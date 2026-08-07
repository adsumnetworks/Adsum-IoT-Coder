import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.UPDATE_MEMORY

// ONE description for every variant. Three things earn their place in it, each because leaving them
// out produced a measured failure:
//   - WHAT each target is for. Without it models put everything in one place and memory becomes prose.
//   - WHEN to write. Without it models treat memory as a wrap-up chore and a killed session loses the day.
//   - The no-logs rule. Without it capture output lands in memory and then rides in every future prompt.
const DESCRIPTION =
	"Records durable project memory in this workspace's `.adsum/` folder — the small set of facts that must survive " +
	"context compaction, a new task, or a new session. You write one named thing per call.\n\n" +
	"TARGETS:\n" +
	'- `goal` — the project\'s objective, in one sentence ("Ship the BWG840 gateway with the BLE-to-UART bridge"). ' +
	"Goals change RARELY. Setting a new one never deletes the old: the previous goal is kept automatically as prior-goal " +
	"history. If what you are recording is this bug rather than what the project is for, it is a defect, not a goal.\n" +
	"- `hw-asserted` — a bench fact only the developer can know and no probe can see: a jumper, a DIP or slide switch " +
	"position, a board mode, what is wired to what. Pass the board's serial or port as `id` when the fact belongs to one board.\n" +
	"- `note` — a topic write-up saved to `.adsum/notes/<id>.md`. Notes are NOT injected into your context; you read them " +
	"back with read_file when you work in that area, so this is where long explanations belong.\n" +
	"- `defect` — one bug you are working on. Defects are CHEAP: open one as soon as you have a symptom and update it every " +
	"time you learn something — a ruled-out hypothesis is worth recording. Every defect write must cite at least one piece " +
	"of evidence as `path:line` or `path:line-line`.\n\n" +
	"WHEN: record findings and decisions as you make them, not at the end. Assume this session can be compacted or ended at " +
	"any moment — anything you have not written here is lost. Write after each Build → Flash → Capture → Analyze cycle, when " +
	"you find a root cause or rule one out, and whenever the developer tells you something about the bench.\n\n" +
	"NEVER PASTE LOG CONTENTS, terminal transcripts, or code dumps. Memory holds the CONCLUSION plus a citation: record the " +
	"log PATH and LINE RANGE (`logs/rtt/cap_1012.log:2211-2247`, `src/gw_uart.c:214`) and what it proved. Writes containing " +
	"runs of log-shaped lines, or a fenced code block over 400 characters, are rejected.\n\n" +
	"NOT YOURS TO WRITE: apps, detected hardware, toolchain and the workspace map are filled in automatically from live " +
	"detection on this machine. If one of them is wrong or missing, say so in your reply and it will be re-probed. " +
	"You also may never mark a defect `verified` — that is host-stamped after a real build/flash/capture confirms your fix. " +
	"Use `state: under-test` to say you believe it is fixed and are waiting on hardware."

const TARGET_PARAMETER = {
	name: "target",
	required: true,
	instruction:
		"What you are recording. Exactly one of: 'goal' (the project's objective — rare to change, and the previous goal is " +
		"preserved as history), 'hw-asserted' (a bench fact only the developer knows: jumper, switch position, board mode, " +
		"wiring), 'note' (a topic write-up saved to .adsum/notes/<id>.md and read back on demand), 'defect' (a bug you are " +
		"working on). 'apps', 'hw-detected', 'toolchain' and 'map' are host-owned and will be rejected.",
	usage: "defect",
}

const OP_PARAMETER = {
	name: "op",
	required: true,
	instruction:
		"What to do: 'set' to create or replace, 'append' to add to what is already there, 'close' to mark a defect resolved " +
		"(defect only, no content needed), 'delete' to remove. target=goal accepts only 'set' — the goal is append-only " +
		"history with the current goal on top, so the previous one is kept automatically.",
	usage: "set",
}

const ID_PARAMETER = {
	name: "id",
	required: false,
	instruction:
		"REQUIRED for target=note (a short slug naming the topic, e.g. 'uart-ringbuffer' — it becomes .adsum/notes/" +
		"uart-ringbuffer.md) and for target=defect (a short stable id for the bug, e.g. 'uart-drop' — reuse the SAME id every " +
		"time you learn something more about it). Optional for target=hw-asserted: pass the board's serial or port so the fact " +
		"is attached to that board. Not used by target=goal.",
	usage: "uart-drop",
}

const CONTENT_PARAMETER = {
	name: "content",
	required: false,
	instruction:
		"What to record. Required for every op except 'close' and 'delete'. For target=defect you may use key lines the host " +
		"understands — 'title: ...', 'state: open' or 'state: under-test', 'evidence: path:line' (one or more, and at least ONE " +
		"is required: 'src/gw_uart.c:214' or 'logs/rtt/cap_1012.log:2211-2247'), 'next: ...', 'tried: ...' — or plain prose, as " +
		"long as it contains at least one path:line citation. Never paste log output, terminal transcripts, or code blocks over " +
		"400 characters: write the conclusion and cite the path and line range instead.",
	usage: "title: UART frames dropped after Wi-Fi reconnect; state: open; evidence: logs/rtt/cap_1012.log:2211-2247; next: log the ring-buffer high-water mark",
}

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: id,
	description: DESCRIPTION,
	parameters: [TARGET_PARAMETER, OP_PARAMETER, ID_PARAMETER, CONTENT_PARAMETER, TASK_PROGRESS_PARAMETER],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_GPT_5,
	parameters: [TARGET_PARAMETER, OP_PARAMETER, ID_PARAMETER, CONTENT_PARAMETER, TASK_PROGRESS_PARAMETER],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
	parameters: [TARGET_PARAMETER, OP_PARAMETER, ID_PARAMETER, CONTENT_PARAMETER, TASK_PROGRESS_PARAMETER],
}

export const update_project_memory_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
