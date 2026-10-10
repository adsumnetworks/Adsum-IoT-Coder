import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"

/** One folded worklog line, or a message that stays on its own — never both, never neither. */
export type FoldedRow =
	| { kind: "single"; message: ClineMessage }
	| { kind: "fold"; category: "tool" | "command" | "kbit"; label: string; messages: ClineMessage[] }

const ERROR_SAYS = new Set(["error", "diff_error", "clineignore_error", "mistake_limit_reached"])

/** A board family the flash-detection regex recognises, in match order (longest/most specific first). */
const BOARD_PATTERN = /\b(nrf9161|nrf9151|nrf5340|nrf52840|nrf52833|nrf52832|esp32s3|esp32c3|esp32)\b/i
const FLASH_VERB = /\b(flash|program|nrfutil\s+device\s+program|west\s+flash)\b/i
const VERSION_PATTERN = /\bv?(\d+\.\d+\.\d+)\b/

/** The category a message folds into — or none, meaning it renders on its own. */
function foldCategoryOf(message: ClineMessage): "tool" | "command" | "kbit" | null {
	if (message.type === "ask") {
		// Asks are the exception path (P4.3's inline approvals) — never folded away.
		return null
	}
	if (message.say === "tool") {
		return "tool"
	}
	if (message.say === "command") {
		return "command"
	}
	if (message.say === "kbit_loaded") {
		return "kbit"
	}
	return null
}

function parseToolSafe(text: string | undefined): ClineSayTool | null {
	try {
		return JSON.parse(text || "{}") as ClineSayTool
	} catch {
		return null
	}
}

/** "read 3 files", "read 1 file, listed 2 folders" — never a path, never a tree location. */
function labelForToolGroup(messages: ClineMessage[]): string {
	const counts = { read: 0, listed: 0, searched: 0, defs: 0, edited: 0, created: 0, other: 0 }
	for (const m of messages) {
		const tool = parseToolSafe(m.text)
		switch (tool?.tool) {
			case "readFile":
				counts.read++
				break
			case "listFilesTopLevel":
			case "listFilesRecursive":
				counts.listed++
				break
			case "searchFiles":
				counts.searched++
				break
			case "listCodeDefinitionNames":
				counts.defs++
				break
			case "editedExistingFile":
				counts.edited++
				break
			case "newFileCreated":
				counts.created++
				break
			default:
				counts.other++
		}
	}
	const parts: string[] = []
	if (counts.read > 0) {
		parts.push(`read ${counts.read} file${counts.read > 1 ? "s" : ""}`)
	}
	if (counts.listed > 0) {
		parts.push(`listed ${counts.listed} folder${counts.listed > 1 ? "s" : ""}`)
	}
	if (counts.searched > 0) {
		parts.push(`searched ${counts.searched} time${counts.searched > 1 ? "s" : ""}`)
	}
	if (counts.defs > 0) {
		parts.push(`looked up ${counts.defs} definition${counts.defs > 1 ? "s" : ""}`)
	}
	if (counts.edited > 0) {
		parts.push(`edited ${counts.edited} file${counts.edited > 1 ? "s" : ""}`)
	}
	if (counts.created > 0) {
		parts.push(`created ${counts.created} file${counts.created > 1 ? "s" : ""}`)
	}
	if (counts.other > 0) {
		parts.push(`used ${counts.other} tool${counts.other > 1 ? "s" : ""}`)
	}
	return parts.length > 0 ? parts.join(", ") : "used a tool"
}

/**
 * "flashed nrf9151 v0.3.3" when a command in the group names a board and a version, else
 * "ran 1 command" / "ran 3 commands". Best-effort pattern match on the command text — there is no
 * structured {board, version} field on a command say, only the shell line itself.
 */
function labelForCommandGroup(messages: ClineMessage[]): string {
	for (const m of messages) {
		const text = m.text || ""
		if (!FLASH_VERB.test(text)) {
			continue
		}
		const board = BOARD_PATTERN.exec(text)?.[1]
		const version = VERSION_PATTERN.exec(text)?.[1]
		if (board && version) {
			return `flashed ${board.toLowerCase()} v${version}`
		}
		if (board) {
			return `flashed ${board.toLowerCase()}`
		}
	}
	return `ran ${messages.length} command${messages.length > 1 ? "s" : ""}`
}

export interface KbitLoadedForFold {
	title: string
	author: string
}

function parseKbitSafe(text: string | undefined): KbitLoadedForFold | null {
	try {
		const p = JSON.parse(text || "{}")
		return p?.title && p?.author ? { title: p.title, author: p.author } : null
	} catch {
		return null
	}
}

/** "loaded ◆ <bit>, curated by <author>" — the existing credit-line convention, as plain worklog text. */
function labelForKbitGroup(messages: ClineMessage[]): string {
	const bits = messages.map((m) => parseKbitSafe(m.text)).filter((b): b is KbitLoadedForFold => b !== null)
	if (bits.length === 0) {
		return "loaded a bit"
	}
	if (bits.length === 1) {
		return `loaded ◆ ${bits[0].title}, curated by ${bits[0].author}`
	}
	const authors = [...new Set(bits.map((b) => b.author))]
	return `loaded ${bits.length} bits, curated by ${authors.join(" + ")}`
}

function labelFor(category: "tool" | "command" | "kbit", messages: ClineMessage[]): string {
	switch (category) {
		case "tool":
			return labelForToolGroup(messages)
		case "command":
			return labelForCommandGroup(messages)
		case "kbit":
			return labelForKbitGroup(messages)
	}
}

/**
 * [P4.2 sessions first] The pure fold: consecutive tool/command/kbit says of the SAME kind collapse into
 * one worklog line each. An ask (any kind — a tool awaiting approval, a question) and a say the mode
 * flags as an error ALWAYS render on their own, unfolded, because they are the exception path a developer
 * has to see, not a line item in a list of things that already happened. Everything else (text, reasoning,
 * api requests, checkpoints, ...) passes through untouched — folding is a worklog concern, not a general
 * grouping pass.
 *
 * Every input message appears in exactly one output row, either standing alone or inside a fold group's
 * `messages` — collapsing a row in the UI is a view toggle on this same array, never a delete.
 */
export function foldRows(messages: ClineMessage[]): FoldedRow[] {
	const out: FoldedRow[] = []
	let bufferCategory: "tool" | "command" | "kbit" | null = null
	let buffer: ClineMessage[] = []

	const flush = () => {
		if (bufferCategory && buffer.length > 0) {
			out.push({ kind: "fold", category: bufferCategory, label: labelFor(bufferCategory, buffer), messages: buffer })
		}
		bufferCategory = null
		buffer = []
	}

	for (const message of messages) {
		if (message.type === "say" && message.say && ERROR_SAYS.has(message.say)) {
			flush()
			out.push({ kind: "single", message })
			continue
		}
		const category = foldCategoryOf(message)
		if (category === null) {
			flush()
			out.push({ kind: "single", message })
			continue
		}
		if (category !== bufferCategory) {
			flush()
			bufferCategory = category
		}
		buffer.push(message)
	}
	flush()

	return out
}

/** Flattens a fold back to its raw messages — used to prove nothing was dropped. */
export function unfoldRows(rows: FoldedRow[]): ClineMessage[] {
	return rows.flatMap((r) => (r.kind === "single" ? [r.message] : r.messages))
}
