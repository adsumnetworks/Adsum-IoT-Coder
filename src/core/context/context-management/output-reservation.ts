import type { ModelInfo } from "@shared/api"

/**
 * How much of a model's context window is reserved for its own reply.
 *
 * THE BUG THIS EXISTS TO FIX (measured on glm-5-turbo, 2026-08-08):
 *
 * Providers count the request as `prompt + max_output_tokens` against the context window. Several
 * models declare an enormous `maxTokens`: glm-5-turbo, glm-4.7 and glm-4.6 all declare 131,072 (or
 * 128,000) output tokens against a 200,000-token window. Asking for all of it leaves only ~69,000
 * tokens for the prompt — but the context budget was computing `200,000 - 40,000 = 160,000` and
 * happily filling it, so every long session ended in:
 *
 *   400 "Prompt exceeds max length" (code 1261)
 *
 * and compaction could not rescue it: the target it was compacting toward was itself impossible.
 *
 * This was latent until the cached-token double-count was fixed. While the gauge over-read by ~1.9x
 * it compacted early enough to stay under the real ceiling by accident; once the gauge told the
 * truth, the prompt was allowed to grow into the impossible zone.
 *
 * A coding agent does not emit 131,072 tokens in one reply — a large file rewrite is a few thousand.
 * Reserving the declared maximum spends two thirds of the window on an outcome that never happens.
 */

/**
 * Ceiling on what we will ask a model to produce in one reply.
 *
 * Chosen to be comfortably above any real agent turn (a full-file rewrite, a long analysis, a big
 * diff) while leaving the window to the conversation. For reference, upstream's Anthropic path has
 * long defaulted to 8,192.
 */
export const MAX_OUTPUT_TOKENS = 32_000

/** Fallback when a model declares no output limit at all. */
const DEFAULT_OUTPUT_TOKENS = 8_192

/**
 * What we will actually request as the output limit — never more than the model allows, never more
 * than {@link MAX_OUTPUT_TOKENS}, and never more than a third of the window (so a small-window model
 * keeps room to think).
 */
export function effectiveMaxOutputTokens(info: Pick<ModelInfo, "maxTokens" | "contextWindow">): number {
	const declared = info.maxTokens && info.maxTokens > 0 ? info.maxTokens : DEFAULT_OUTPUT_TOKENS
	const window = info.contextWindow && info.contextWindow > 0 ? info.contextWindow : 128_000
	return Math.max(1_024, Math.min(declared, MAX_OUTPUT_TOKENS, Math.floor(window / 3)))
}

/**
 * Tokens to hold back from the prompt budget for the reply. This is what we will request plus a
 * margin for the provider counting tokens slightly differently than we estimate.
 */
export function outputReservation(info: Pick<ModelInfo, "maxTokens" | "contextWindow">): number {
	return effectiveMaxOutputTokens(info) + 4_000
}
