import { toolUseNames } from "@shared/tools"
import { toolParamNames } from "."

// Pre-pass normalization for streamed assistant messages.
//
// Some providers emit tool calls in formats the main XML parser does not
// understand: DeepSeek-V4-class models can leak their native DeepSeek Smart
// Markup Language (DSML) function-call tokens, and several smaller models
// like to wrap tool calls in markdown code fences. Without this pre-pass
// those messages produce the user-facing "Invalid API Response" or
// "You did not use a tool" errors even though the model's intent was clear.
//
// The transforms here are lossless and idempotent — running on
// already-normalized input is a no-op. Only complete (open+close) blocks
// are rewritten, so mid-stream partial chunks are passed through unchanged
// and rewritten once the closing token arrives.

// Token strings use DeepSeek's fullwidth pipe characters (U+FF5C).
const DSML_INVOKE_RE = /<｜｜DSML｜｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜invoke>/g
const DSML_PARAM_RE = /<｜｜DSML｜｜parameter\s+name="([^"]+)"(?:\s+string="[^"]*")?\s*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g
const DSML_TOOL_CALLS_OPEN_RE = /<｜｜DSML｜｜tool_calls>\s*/g
const DSML_TOOL_CALLS_CLOSE_RE = /\s*<\/｜｜DSML｜｜tool_calls>/g

// Markdown code fence around tool-call XML. Lazy match so we don't span fences.
const CODE_FENCE_RE = /```(?:xml|tool|tool_use|tool_calls)?\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/g

// `toolParamNames` lives in this directory's index.ts, which forms a circular
// import via parse-assistant-message.ts. Reading it at module-init time
// produces `undefined`, so we resolve it lazily on first call.
let _knownToolNames: Set<string> | undefined
let _knownParamNames: Set<string> | undefined
let _toolOpenTagRe: RegExp | undefined

function knownToolNames(): Set<string> {
	if (!_knownToolNames) {
		_knownToolNames = new Set<string>(toolUseNames as readonly string[])
	}
	return _knownToolNames
}

function knownParamNames(): Set<string> {
	if (!_knownParamNames) {
		_knownParamNames = new Set<string>(toolParamNames as readonly string[])
	}
	return _knownParamNames
}

function toolOpenTagRe(): RegExp {
	if (!_toolOpenTagRe) {
		_toolOpenTagRe = new RegExp(`<(?:${[...knownToolNames()].join("|")})>`, "m")
	}
	return _toolOpenTagRe
}

function rewriteDSML(message: string): string {
	if (!message.includes("DSML")) {
		return message
	}

	let out = message

	const params = knownParamNames()
	const tools = knownToolNames()

	// Parameters first (innermost). Unknown names are left untouched so they
	// surface as a parse failure rather than being silently relabeled.
	out = out.replace(DSML_PARAM_RE, (match, name: string, body: string) => {
		if (!params.has(name)) {
			return match
		}
		return `<${name}>${body}</${name}>`
	})

	// Invokes (outer). Same allowlist guard.
	out = out.replace(DSML_INVOKE_RE, (match, name: string, body: string) => {
		if (!tools.has(name)) {
			return match
		}
		return `<${name}>${body}</${name}>`
	})

	// Strip the outer tool_calls wrapper — purely structural, no semantic content.
	out = out.replace(DSML_TOOL_CALLS_OPEN_RE, "")
	out = out.replace(DSML_TOOL_CALLS_CLOSE_RE, "")

	return out
}

function stripCodeFencesAroundToolCalls(message: string): string {
	if (!message.includes("```")) {
		return message
	}
	const toolOpenRe = toolOpenTagRe()
	return message.replace(CODE_FENCE_RE, (match, body: string) => {
		// Only unwrap when the fence body actually contains a recognizable
		// tool-use opening tag — leaves legitimate code blocks alone.
		// `test()` on a non-global regex doesn't move lastIndex, so it's
		// safe to share across calls.
		return toolOpenRe.test(body) ? body : match
	})
}

export function normalizeAssistantMessage(message: string): string {
	if (!message) {
		return message
	}
	const dsmlNormalized = rewriteDSML(message)
	return stripCodeFencesAroundToolCalls(dsmlNormalized)
}
