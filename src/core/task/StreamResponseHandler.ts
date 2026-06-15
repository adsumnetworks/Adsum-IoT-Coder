import type { ToolUse } from "@core/assistant-message"
import { JSONParser } from "@streamparser/json"
import { McpHub } from "@/services/mcp/McpHub"
import { CLINE_MCP_TOOL_IDENTIFIER } from "@/shared/mcp"
import {
	ClineAssistantRedactedThinkingBlock,
	ClineAssistantThinkingBlock,
	ClineAssistantToolUseBlock,
	ClineReasoningDetailParam,
} from "@/shared/messages/content"
import { ClineDefaultTool } from "@/shared/tools"

export interface PendingToolUse {
	id: string
	name: string
	input: string
	parsedInput?: unknown
	signature?: string
	jsonParser?: JSONParser
	call_id?: string
}

interface ToolUseDeltaBlock {
	id?: string
	type?: string
	name?: string
	input?: string
	signature?: string
}

export interface ReasoningDelta {
	id?: string
	reasoning?: string
	signature?: string
	details?: any[]
	redacted_data?: any
}

export interface PendingReasoning {
	id?: string
	content: string
	signature: string
	redactedThinking: ClineAssistantRedactedThinkingBlock[]
	summary: unknown[] | ClineReasoningDetailParam[]
}

const ESCAPE_MAP: Record<string, string> = {
	"\\n": "\n",
	"\\t": "\t",
	"\\r": "\r",
	'\\"': '"',
	"\\\\": "\\",
}

const ESCAPE_PATTERN = /\\[ntr"\\]/g

// Tool-call argument fields that are allowed to surface while still streaming (partial value).
// These are the large, last-streamed payloads we render incrementally (the diff-view animation).
// Any other field — notably the file path — must be complete before it is used.
const STREAMABLE_PARTIAL_FIELDS = new Set(["content", "diff"])

export class StreamResponseHandler {
	private toolUseHandler = new ToolUseHandler()
	private reasoningHandler = new ReasoningHandler()

	private _requestId: string | undefined

	public setRequestId(id?: string) {
		if (!this._requestId && id) {
			this._requestId = id
		}
	}

	public get requestId() {
		return this._requestId
	}

	public getHandlers() {
		return {
			toolUseHandler: this.toolUseHandler,
			reasonsHandler: this.reasoningHandler,
		}
	}

	public reset() {
		this._requestId = undefined
		this.toolUseHandler = new ToolUseHandler()
		this.reasoningHandler = new ReasoningHandler()
	}
}

/**
 * Handles streaming native tool use blocks and converts them to ClineAssistantToolUseBlock format
 */
class ToolUseHandler {
	private pendingToolUses = new Map<string, PendingToolUse>()

	processToolUseDelta(delta: ToolUseDeltaBlock, call_id?: string): void {
		if (delta.type !== "tool_use" || !delta.id) {
			return
		}

		let pending = this.pendingToolUses.get(delta.id)
		if (!pending) {
			pending = this.createPendingToolUse(delta.id, delta.name || "", call_id)
		}

		if (delta.name) {
			pending.name = delta.name
		}

		if (delta.signature) {
			pending.signature = delta.signature
		}

		if (delta.input) {
			pending.input += delta.input
			try {
				pending.jsonParser?.write(delta.input)
			} catch {
				// Expected during streaming - JSONParser may not have complete JSON yet
			}
		}
	}

	getFinalizedToolUse(id: string): ClineAssistantToolUseBlock | undefined {
		const pending = this.pendingToolUses.get(id)
		if (!pending?.name) {
			return undefined
		}

		let input: unknown = {}
		if (pending.parsedInput != null) {
			input = pending.parsedInput
		} else if (pending.input) {
			try {
				input = JSON.parse(pending.input)
			} catch {
				input = this.extractPartialJsonFields(pending.input)
			}
		}

		return {
			type: "tool_use",
			id: pending.id,
			name: pending.name,
			input,
			signature: pending.signature,
			call_id: pending.call_id,
		}
	}

	getAllFinalizedToolUses(summary?: ClineAssistantToolUseBlock["reasoning_details"]): ClineAssistantToolUseBlock[] {
		const results: ClineAssistantToolUseBlock[] = []
		for (const id of this.pendingToolUses.keys()) {
			const toolUse = this.getFinalizedToolUse(id)
			if (toolUse) {
				results.push({ ...toolUse, reasoning_details: summary })
			}
		}
		return results
	}

	hasToolUse(id: string): boolean {
		return this.pendingToolUses.has(id)
	}

	getPartialToolUsesAsContent(): ToolUse[] {
		const results: ToolUse[] = []
		const pendingToolUses = this.pendingToolUses.values()

		for (const pending of pendingToolUses) {
			if (!pending.name) {
				continue
			}

			// Try to get the most up-to-date parsed input
			// Priority: parsedInput (from JSONParser) > fallback to manual parsing
			let input: any = {}
			if (pending.parsedInput != null) {
				input = pending.parsedInput
			} else if (pending.input) {
				// Try full JSON parse first
				try {
					input = JSON.parse(pending.input)
				} catch {
					// Fall back to extracting partial fields from incomplete JSON
					input = this.extractPartialJsonFields(pending.input)
				}
			}

			if (pending.name.includes(CLINE_MCP_TOOL_IDENTIFIER)) {
				const [key, toolName] = pending.name.split(CLINE_MCP_TOOL_IDENTIFIER)
				results.push({
					type: "tool_use",
					name: ClineDefaultTool.MCP_USE,
					params: {
						server_name: McpHub.getMcpServerByKey(key),
						tool_name: toolName,
						arguments: JSON.stringify(input),
					},
					partial: true,
					isNativeToolCall: true,
					signature: pending.signature,
					call_id: pending.call_id,
				})
			} else {
				const params: Record<string, string> = {}
				if (typeof input === "object" && input !== null) {
					for (const [key, value] of Object.entries(input)) {
						params[key] = typeof value === "string" ? value : JSON.stringify(value)
					}
				}
				results.push({
					type: "tool_use",
					name: pending.name as ClineDefaultTool,
					params: params as any,
					partial: true,
					signature: pending.signature,
					isNativeToolCall: true,
					call_id: pending.call_id,
				})
			}
		}
		// Ensure all returned tool uses are marked as partial
		return results.map((t) => ({ ...t, partial: true }))
	}

	reset(): void {
		this.pendingToolUses.clear()
	}

	private createPendingToolUse(id: string, name: string, call_id?: string): PendingToolUse {
		const jsonParser = new JSONParser()
		const pending: PendingToolUse = {
			id,
			name,
			input: "",
			parsedInput: undefined,
			jsonParser,
			call_id,
			signature: undefined,
		}

		jsonParser.onValue = (info: any) => {
			if (info.stack.length === 0 && info.value && typeof info.value === "object") {
				pending.parsedInput = info.value
			}
		}

		jsonParser.onError = () => {}

		this.pendingToolUses.set(id, pending)
		return pending
	}

	private extractPartialJsonFields(partialJson: string): Record<string, any> {
		const result: Record<string, any> = {}
		// Group 3 captures the closing quote, present only when the value is fully streamed.
		const pattern = /"(\w+)":\s*"((?:[^"\\]|\\.)*)(")?/g

		for (const match of partialJson.matchAll(pattern)) {
			const [, key, value, closingQuote] = match
			// Only surface a field whose value is TERMINATED. The long streaming fields
			// (content / diff) are intentionally rendered incrementally, so they may stay
			// partial. Everything else — most importantly the file path (absolutePath / path)
			// — must be complete before a consumer uses it: opening the diff editor on a
			// half-streamed path points it at the wrong file and the write fails with
			// "User closed text editor". See WriteToFileToolHandler.handlePartialBlock.
			if (closingQuote || STREAMABLE_PARTIAL_FIELDS.has(key)) {
				result[key] = value.replace(ESCAPE_PATTERN, (m) => ESCAPE_MAP[m])
			}
		}

		return result
	}
}

/**
 * Handles streaming reasoning content and converts it to the appropriate message format
 */
class ReasoningHandler {
	private pendingReasoning: PendingReasoning | null = null

	processReasoningDelta(delta: ReasoningDelta): void {
		// Initialize pending reasoning if we have an ID but no pending reasoning yet
		if (!this.pendingReasoning) {
			this.pendingReasoning = {
				id: delta.id,
				content: "",
				signature: "",
				redactedThinking: [],
				summary: [],
			}
		}

		if (!this.pendingReasoning) {
			return
		}

		// Update fields from delta
		if (delta.reasoning) {
			this.pendingReasoning.content += delta.reasoning
		}
		if (delta.signature) {
			this.pendingReasoning.signature = delta.signature
		}
		if (delta.details) {
			if (Array.isArray(delta.details)) {
				this.pendingReasoning.summary.push(...delta.details)
			} else {
				this.pendingReasoning.summary.push(delta.details)
			}
		}
		if (delta.redacted_data) {
			this.pendingReasoning.redactedThinking.push({
				type: "redacted_thinking",
				data: delta.redacted_data,
				call_id: delta.id || this.pendingReasoning.id,
			})
		}
	}

	getCurrentReasoning(): ClineAssistantThinkingBlock | null {
		if (!this.pendingReasoning) {
			return null
		}

		if (!this.pendingReasoning.summary.length && !this.pendingReasoning.content) {
			return null
		}

		// Ensure signature is set if it's hidden in the summary / reasoning details
		// to ensure it's always accessible at the top level by each provider.
		if (!this.pendingReasoning.signature && this.pendingReasoning.summary.length) {
			const lastSummary = this.pendingReasoning.summary.at(-1)
			if (lastSummary && typeof lastSummary === "object" && "signature" in lastSummary) {
				if (typeof lastSummary.signature === "string") {
					this.pendingReasoning.signature = lastSummary.signature
				}
			}
		}

		return {
			type: "thinking",
			thinking: this.pendingReasoning.content,
			signature: this.pendingReasoning.signature,
			summary: this.pendingReasoning.summary,
			call_id: this.pendingReasoning.id,
		}
	}

	getRedactedThinking(): ClineAssistantRedactedThinkingBlock[] {
		return this.pendingReasoning?.redactedThinking || []
	}

	reset(): void {
		this.pendingReasoning = null
	}
}
