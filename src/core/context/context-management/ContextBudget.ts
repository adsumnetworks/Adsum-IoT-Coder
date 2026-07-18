import type { Anthropic } from "@anthropic-ai/sdk"

/**
 * Context budget projection — see the wall coming instead of hitting it.
 *
 * Ported from Cline's SDK context pipeline (`sdk/packages/core/src/extensions/context/compaction-shared.ts`,
 * upstream @ 557d7256, Apache-2.0), adapted to this fork's ApiHandler/Anthropic message shape.
 *
 * WHY THIS EXISTS. The engine we forked reacts to a full context by DELETING a fraction of the transcript
 * chosen by message COUNT (`getNextTruncationRange`: "half" or "quarter" of remaining pairs). That is blind in
 * two directions: it does not know whether those messages are 1k tokens or 100k, and it cannot tell that the
 * last few turns — the ones the model is actually reasoning about — are the ones being thrown away. On a long
 * IoT session (a CRA sweep, a BLE debug carrying big captures) the result is an agent that silently loses the
 * first half of its own work.
 *
 * This module makes the decision token-aware and, crucially, EARLY: a projection reports how close a turn is
 * to the usable budget so the caller can compact at a chosen ratio rather than at the failure edge.
 */

/** Rough token estimate. Cheap and deterministic — the real accounting still comes from the provider. */
export const CHARS_PER_TOKEN = 4

/** Fallback when a model reports no window at all. */
export const DEFAULT_MAX_INPUT_TOKENS = 128_000

/** When only a context window is known, reserve a margin for response + request overhead. */
export const CONTEXT_WINDOW_INPUT_RATIO = 0.9

/** Compact once the transcript reaches this share of the usable input budget. */
export const COMPACTION_TRIGGER_RATIO = 0.9

/** Compact down to this share — leaving headroom so the next few turns don't immediately re-trigger. */
export const DEFAULT_TARGET_RATIO = 0.7

/** Never compact away this much of the most recent conversation: it is what the model is reasoning about. */
export const DEFAULT_PRESERVE_RECENT_TOKENS = 20_000

/** Warn (telemetry / UI) before acting, so a long run can be observed approaching its limit. */
export const WARN_RATIO = 0.75

export type BudgetState = "ok" | "warn" | "compact" | "emergency"

export interface ContextBudget {
	/** Usable input budget for this model. */
	effectiveMaxInputTokens: number
	/** Compact at or above this. */
	triggerTokens: number
	/** Compact down to roughly this. */
	targetTokens: number
	/** Recent tail that must survive compaction. */
	preserveRecentTokens: number
	usedTokens: number
	usedRatio: number
	state: BudgetState
	/** Tokens that need to go to reach target; 0 when no action is due. */
	tokensToReclaim: number
}

function positive(n: unknown): n is number {
	return typeof n === "number" && Number.isFinite(n) && n > 0
}

/**
 * Usable prompt budget for a model. A reported input limit wins but can never exceed the context window;
 * with only a window known, keep a conservative margin rather than assuming the whole window is promptable.
 */
export function resolveEffectiveMaxInputTokens(info: { contextWindow?: number; maxInputTokens?: number }): number {
	const contextWindow = positive(info.contextWindow) ? info.contextWindow : undefined
	const maxInputTokens = positive(info.maxInputTokens) ? info.maxInputTokens : undefined
	if (maxInputTokens !== undefined) {
		return contextWindow === undefined ? maxInputTokens : Math.min(maxInputTokens, contextWindow)
	}
	if (contextWindow === undefined) {
		return DEFAULT_MAX_INPUT_TOKENS
	}
	return Math.floor(contextWindow * CONTEXT_WINDOW_INPUT_RATIO)
}

/** Estimate the tokens a single message contributes. Counts text and tool payloads; images are approximated. */
export function estimateMessageTokens(message: Anthropic.Messages.MessageParam): number {
	const content = message.content
	if (typeof content === "string") {
		return Math.ceil(content.length / CHARS_PER_TOKEN)
	}
	if (!Array.isArray(content)) {
		return 0
	}
	let chars = 0
	for (const raw of content) {
		const block = raw as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown }
		if (typeof raw === "string") {
			chars += (raw as string).length
			continue
		}
		switch (block.type) {
			case "text":
				chars += block.text?.length ?? 0
				break
			case "tool_use":
				chars += JSON.stringify(block.input ?? {}).length + (block.name?.length ?? 0)
				break
			case "tool_result": {
				const c = block.content
				chars += typeof c === "string" ? c.length : JSON.stringify(c ?? "").length
				break
			}
			case "image":
				// A base64 image is not worth measuring by character count; use a flat, deliberately
				// conservative allowance so an image-heavy turn still registers against the budget.
				chars += 4_000
				break
			default:
				chars += JSON.stringify(block).length
		}
	}
	return Math.ceil(chars / CHARS_PER_TOKEN)
}

export function estimateTotalTokens(messages: Anthropic.Messages.MessageParam[]): number {
	let total = 0
	for (const m of messages) {
		total += estimateMessageTokens(m)
	}
	return total
}

/**
 * Project a turn against its budget.
 *
 * `usedTokens` should be the provider's own accounting when available (in + out + cache), because that is the
 * only number that reflects the real prompt; the estimator above is the fallback for a turn that has not been
 * measured yet. `emergency` means the transcript is already past the usable budget — the caller must reclaim
 * aggressively rather than merely trim.
 */
export function projectContextBudget(options: {
	usedTokens: number
	modelInfo: { contextWindow?: number; maxInputTokens?: number }
	/** Override the compaction target (0..1 of the effective max). */
	targetRatio?: number
	preserveRecentTokens?: number
}): ContextBudget {
	const effectiveMaxInputTokens = resolveEffectiveMaxInputTokens(options.modelInfo)
	const targetRatio = Math.min(0.95, Math.max(0.05, options.targetRatio ?? DEFAULT_TARGET_RATIO))
	const triggerTokens = Math.floor(effectiveMaxInputTokens * COMPACTION_TRIGGER_RATIO)
	const targetTokens = Math.floor(effectiveMaxInputTokens * targetRatio)
	const usedTokens = Math.max(0, options.usedTokens)
	const usedRatio = effectiveMaxInputTokens > 0 ? usedTokens / effectiveMaxInputTokens : 0

	let state: BudgetState = "ok"
	if (usedTokens >= effectiveMaxInputTokens) {
		state = "emergency"
	} else if (usedTokens >= triggerTokens) {
		state = "compact"
	} else if (usedRatio >= WARN_RATIO) {
		state = "warn"
	}

	return {
		effectiveMaxInputTokens,
		triggerTokens,
		targetTokens,
		preserveRecentTokens: options.preserveRecentTokens ?? DEFAULT_PRESERVE_RECENT_TOKENS,
		usedTokens,
		usedRatio,
		state,
		tokensToReclaim: state === "ok" || state === "warn" ? 0 : Math.max(0, usedTokens - targetTokens),
	}
}

/**
 * Choose an inclusive [start, end] slice of history to drop so the transcript reaches its target, while
 * protecting BOTH ends: the opening user/assistant pair (the task statement the whole session hangs off) and
 * a recent tail worth `preserveRecentTokens` (what the model is actively working with).
 *
 * This is the token-aware replacement for count-based `getNextTruncationRange("half" | "quarter")`. It walks
 * forward from the oldest compactable message and stops the moment enough has been reclaimed, so a session
 * carrying one enormous log capture drops that capture instead of half its reasoning.
 *
 * Returns undefined when nothing can be dropped without breaching a protected region — the caller must then
 * fall back (summarise, or the legacy range) rather than silently doing nothing.
 */
export function planTokenAwareTruncation(options: {
	messages: Anthropic.Messages.MessageParam[]
	currentDeletedRange: [number, number] | undefined
	tokensToReclaim: number
	preserveRecentTokens: number
}): [number, number] | undefined {
	const { messages, currentDeletedRange, tokensToReclaim, preserveRecentTokens } = options
	if (tokensToReclaim <= 0) {
		return undefined
	}
	// Index 0/1 are the opening pair and are never removable.
	const rangeStartIndex = 2
	const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : rangeStartIndex
	if (startOfRest >= messages.length) {
		return undefined
	}

	// Walk backwards accumulating the protected tail — but never past the midpoint of the compactable
	// region. Without that floor a single enormous OLD message can satisfy "keep the last N tokens" all by
	// itself and block compaction entirely: the token rule would call the 3rd message of a 14-message
	// session "recent" purely because everything after it is small. Position matters as well as size.
	const midpoint = startOfRest + Math.floor((messages.length - startOfRest) / 2)
	const tailFloor = Math.max(startOfRest, midpoint)
	let tailTokens = 0
	let protectedFrom = messages.length
	for (let i = messages.length - 1; i >= tailFloor; i--) {
		tailTokens += estimateMessageTokens(messages[i])
		protectedFrom = i
		if (tailTokens >= preserveRecentTokens) {
			break
		}
	}

	// Walk forward from the oldest compactable message, removing until the debt is paid.
	let reclaimed = 0
	let end = startOfRest - 1
	for (let i = startOfRest; i < protectedFrom; i++) {
		reclaimed += estimateMessageTokens(messages[i])
		end = i
		if (reclaimed >= tokensToReclaim) {
			break
		}
	}
	if (end < startOfRest) {
		return undefined
	}

	// Keep the user/assistant alternation intact: the message after the removed slice must be a user turn,
	// so the slice has to end on an assistant message (this fork is Anthropic-shaped throughout).
	// EXTEND to swallow the paired assistant reply where one is available, rather than shrinking — shrinking
	// would abandon a huge user message (a pasted log) that is the entire reason we are compacting.
	if (messages[end] && messages[end].role !== "assistant") {
		if (end + 1 < protectedFrom && messages[end + 1]?.role === "assistant") {
			end += 1
		} else {
			end -= 1
		}
	}
	if (end < startOfRest) {
		return undefined
	}
	return [rangeStartIndex, end]
}
