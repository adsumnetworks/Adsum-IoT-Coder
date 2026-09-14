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
/*
 * The markup as models actually write it, not as it is documented.
 *
 * A real session (bench task 1789341500200, a small model at a 1,024 thinking budget) sent this, and
 * the tidy patterns matched none of it:
 *
 *   <｜｜DSML｜｜ calls>
 *   <｜｜DSML｜｜ invoke name="list_files">
 *   <｜｜DSML｜｜ parameter name="path" string="true">…</｜｜DSML｜｜ parameter>
 *   <｜｜DSML｜｜ parameter name="recursive>true</｜｜DSML｜｜ parameter>
 *   <｜｜DSML｜｜ parameter name="task_progress>…</task_progress>
 *
 * Three differences, all of which must be tolerated: a SPACE after the marker; the wrapper written
 * as "calls" rather than "tool_calls"; and a name attribute that never closes its quote, once
 * closing with the parameter's own name instead of the markup's tag. The engine saw no tool, told
 * the model so, the model concluded our parser was broken and repeated the identical call, and the
 * session died on the mistake limit in twenty seconds having executed nothing.
 *
 * Tolerated, not guessed at: the allowlists below still decide what a name MEANS, so a malformed
 * block naming something we do not know is left alone to fail loudly rather than being relabelled.
 */
const DSML_INVOKE_RE = /<｜｜DSML｜｜\s*invoke\s+name="([^">]+)"?\s*>([\s\S]*?)<\/｜｜DSML｜｜\s*invoke>/g
const DSML_PARAM_RE =
	/<｜｜DSML｜｜\s*parameter\s+name="([^">]+)"?(?:\s+string="[^"]*")?\s*>([\s\S]*?)(?:<\/｜｜DSML｜｜\s*parameter>|<\/\1>)/g
const DSML_TOOL_CALLS_OPEN_RE = /<｜｜DSML｜｜\s*(?:tool_)?calls>\s*/g
const DSML_TOOL_CALLS_CLOSE_RE = /\s*<\/｜｜DSML｜｜\s*(?:tool_)?calls>/g

// Markdown code fence around tool-call XML. Lazy match so we don't span fences.
const CODE_FENCE_RE = /```(?:xml|tool|tool_use|tool_calls)?\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/g

// "Literal template mimicry" — weaker models (Haiku 3.5, smaller open-source
// models) on the generic prompt variant read the format-reminder placeholder
// names ("tool_name", "parameter_name") as actual XML tags instead of
// substituting them. Shape:
//   <tool_name>NAME</tool_name>           (sometimes closes with </parameter_name>)
//   <parameter_name>KEY>VAL</parameter_name>
//   <parameter_name>KEY>VAL</parameter_name>
//   </tool_name>
// Rewriting is safe because `tool_name` and `parameter_name` are never
// valid Cline tool/param identifiers, and we allowlist NAME/KEY against
// the real tool/param tables before rewriting.
const LITERAL_TEMPLATE_OUTER_RE =
	/<tool_name>(\w+)<\/(?:tool_name|parameter_name)>\s*((?:<parameter_name>[\s\S]*?<\/parameter_name>\s*)+)<\/tool_name>/g

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

function rewriteLiteralTemplateMimic(message: string): string {
	if (!message.includes("<tool_name>")) {
		return message
	}
	const tools = knownToolNames()
	const params = knownParamNames()

	return message.replace(LITERAL_TEMPLATE_OUTER_RE, (match, toolName: string, paramsBlock: string) => {
		if (!tools.has(toolName)) {
			return match
		}
		// Walk each <parameter_name>KEY>VAL</parameter_name> block. The KEY>
		// idiom is the consistent quirk of this misformat — placeholder name
		// followed by the substituted name, separated by '>'.
		const paramRe = /<parameter_name>(\w+)>([\s\S]*?)<\/parameter_name>/g
		const parts: string[] = []
		let pm: RegExpExecArray | null
		while ((pm = paramRe.exec(paramsBlock)) !== null) {
			const [, key, value] = pm
			if (!params.has(key)) {
				// Unknown param name — bail out so we don't synthesize garbage.
				return match
			}
			parts.push(`<${key}>${value.trim()}</${key}>`)
		}
		if (parts.length === 0) {
			return match
		}
		return `<${toolName}>${parts.join("")}</${toolName}>`
	})
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
	const templateNormalized = rewriteLiteralTemplateMimic(dsmlNormalized)
	return stripCodeFencesAroundToolCalls(templateNormalized)
}
