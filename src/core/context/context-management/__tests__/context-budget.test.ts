import { strict as assert } from "node:assert"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import type { Anthropic } from "@anthropic-ai/sdk"
import {
	buildCompactionState,
	hashPrefix,
	isCompactionStateValid,
	loadCompactionState,
	saveCompactionState,
} from "../CompactionState"
import {
	COMPACTION_TRIGGER_RATIO,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	estimateMessageTokens,
	planTokenAwareTruncation,
	projectContextBudget,
	resolveEffectiveMaxInputTokens,
} from "../ContextBudget"

const msg = (role: "user" | "assistant", text: string): Anthropic.Messages.MessageParam => ({ role, content: text })
/** ~n tokens at 4 chars/token. */
const sized = (role: "user" | "assistant", tokens: number) => msg(role, "x".repeat(tokens * 4))

describe("ContextBudget — effective max", () => {
	it("a reported input limit wins but never exceeds the window", () => {
		assert.equal(resolveEffectiveMaxInputTokens({ contextWindow: 200_000, maxInputTokens: 120_000 }), 120_000)
		assert.equal(resolveEffectiveMaxInputTokens({ contextWindow: 100_000, maxInputTokens: 500_000 }), 100_000)
	})

	it("window-only keeps a margin rather than assuming the whole window is promptable", () => {
		assert.equal(resolveEffectiveMaxInputTokens({ contextWindow: 200_000 }), 180_000)
	})

	it("an unknown model still yields a usable budget", () => {
		assert.equal(resolveEffectiveMaxInputTokens({}), 128_000)
	})
})

describe("ContextBudget — projection sees the wall coming", () => {
	const modelInfo = { contextWindow: 200_000, maxInputTokens: 100_000 }

	it("is quiet well below the limit", () => {
		assert.equal(projectContextBudget({ usedTokens: 10_000, modelInfo }).state, "ok")
	})

	it("warns BEFORE it acts — the point of projecting at all", () => {
		const b = projectContextBudget({ usedTokens: 80_000, modelInfo })
		assert.equal(b.state, "warn")
		assert.equal(b.tokensToReclaim, 0, "a warning must not reclaim anything")
	})

	it("compacts at the trigger ratio, not at the failure edge", () => {
		const b = projectContextBudget({ usedTokens: COMPACTION_TRIGGER_RATIO * 100_000, modelInfo })
		assert.equal(b.state, "compact")
		assert.ok(b.usedTokens < b.effectiveMaxInputTokens, "acts while there is still headroom")
		assert.ok(b.tokensToReclaim > 0)
	})

	it("flags an over-budget transcript as an emergency", () => {
		assert.equal(projectContextBudget({ usedTokens: 120_000, modelInfo }).state, "emergency")
	})

	it("reclaims down to the target, leaving room so the next turn does not re-trigger", () => {
		const b = projectContextBudget({ usedTokens: 95_000, modelInfo })
		assert.equal(b.usedTokens - b.tokensToReclaim, b.targetTokens)
		assert.ok(b.targetTokens < b.triggerTokens)
	})
})

describe("ContextBudget — token-aware truncation plan", () => {
	it("drops the ONE huge message instead of half the conversation", () => {
		// The failure this whole change exists for: a giant log capture early on, then real reasoning.
		const messages = [
			msg("user", "debug my board"),
			msg("assistant", "sure"),
			sized("user", 50_000), // the capture
			sized("assistant", 100),
			...Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? sized("user", 50) : sized("assistant", 50))),
		]
		const plan = planTokenAwareTruncation({
			messages,
			currentDeletedRange: undefined,
			tokensToReclaim: 40_000,
			preserveRecentTokens: 2_000,
		})
		assert.ok(plan, "expected a plan")
		assert.equal(plan[0], 2, "opening pair is never removed")
		assert.ok(plan[1] <= 3, `should stop right after the huge message, got end=${plan[1]}`)
	})

	it("never touches the opening user/assistant pair", () => {
		const messages = [msg("user", "task"), msg("assistant", "ok"), ...Array.from({ length: 20 }, (_, i) => sized(i % 2 === 0 ? "user" : "assistant", 500))]
		const plan = planTokenAwareTruncation({
			messages,
			currentDeletedRange: undefined,
			tokensToReclaim: 5_000,
			preserveRecentTokens: 1_000,
		})
		assert.ok(plan)
		assert.equal(plan[0], 2)
	})

	it("protects the recent tail — what the model is actually reasoning about", () => {
		const messages = [msg("user", "task"), msg("assistant", "ok"), ...Array.from({ length: 20 }, (_, i) => sized(i % 2 === 0 ? "user" : "assistant", 1_000))]
		const preserve = 5_000
		const plan = planTokenAwareTruncation({
			messages,
			currentDeletedRange: undefined,
			tokensToReclaim: 100_000, // more than exists — must still not eat the tail
			preserveRecentTokens: preserve,
		})
		assert.ok(plan)
		let tail = 0
		for (let i = messages.length - 1; i > plan[1]; i--) {
			tail += estimateMessageTokens(messages[i])
		}
		assert.ok(tail >= preserve, `tail ${tail} must cover the ${preserve} preserve floor`)
	})

	it("ends a removal on an assistant message so the alternation survives", () => {
		const messages = [msg("user", "task"), msg("assistant", "ok"), ...Array.from({ length: 12 }, (_, i) => sized(i % 2 === 0 ? "user" : "assistant", 800))]
		const plan = planTokenAwareTruncation({
			messages,
			currentDeletedRange: undefined,
			tokensToReclaim: 2_000,
			preserveRecentTokens: 1_000,
		})
		assert.ok(plan)
		assert.equal(messages[plan[1]].role, "assistant")
	})

	it("returns undefined rather than breaching a protected region", () => {
		const messages = [msg("user", "task"), msg("assistant", "ok"), sized("user", 10), sized("assistant", 10)]
		const plan = planTokenAwareTruncation({
			messages,
			currentDeletedRange: undefined,
			tokensToReclaim: 1_000,
			preserveRecentTokens: DEFAULT_PRESERVE_RECENT_TOKENS,
		})
		assert.equal(plan, undefined, "caller must fall back, not silently do nothing wrong")
	})

	it("no debt ⇒ no plan", () => {
		assert.equal(
			planTokenAwareTruncation({ messages: [msg("user", "a"), msg("assistant", "b")], currentDeletedRange: undefined, tokensToReclaim: 0, preserveRecentTokens: 100 }),
			undefined,
		)
	})
})

describe("CompactionState — resume must never fabricate history", () => {
	const history = [msg("user", "task"), msg("assistant", "ok"), msg("user", "more"), msg("assistant", "done")]

	it("round-trips through disk", async () => {
		const dir = mkdtempSync(join(tmpdir(), "compaction-"))
		try {
			const state = buildCompactionState({ messages: history, compactedThroughIndex: 2, tokensBefore: 900, tokensAfter: 300, strategy: "truncation", modelId: "m" })
			await saveCompactionState(dir, state)
			assert.ok(existsSync(join(dir, "compaction_state.json")))
			const loaded = await loadCompactionState(dir)
			assert.equal(loaded?.prefixHash, state.prefixHash)
			assert.ok(isCompactionStateValid(loaded, history))
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("REJECTS state when the prefix content changed but the length did not", () => {
		// The dangerous case: same message count, different content (an edit, a restored checkpoint). An
		// index-only check would accept this and let the agent describe work that no longer exists.
		const state = buildCompactionState({ messages: history, compactedThroughIndex: 2, tokensBefore: 1, tokensAfter: 1, strategy: "truncation" })
		const edited = [...history]
		edited[1] = msg("assistant", "something entirely different")
		assert.equal(isCompactionStateValid(state, edited), false)
	})

	it("rejects state pointing past the end of a shortened history", () => {
		const state = buildCompactionState({ messages: history, compactedThroughIndex: 3, tokensBefore: 1, tokensAfter: 1, strategy: "truncation" })
		assert.equal(isCompactionStateValid(state, history.slice(0, 2)), false)
	})

	it("accepts an unchanged prefix even when messages were APPENDED after it", () => {
		// The normal resume: work continued past the compaction boundary.
		const state = buildCompactionState({ messages: history, compactedThroughIndex: 1, tokensBefore: 1, tokensAfter: 1, strategy: "truncation" })
		assert.ok(isCompactionStateValid(state, [...history, msg("user", "new turn"), msg("assistant", "reply")]))
	})

	it("hashes content, not just shape", () => {
		assert.notEqual(hashPrefix(history, 1), hashPrefix([msg("user", "task"), msg("assistant", "different")], 1))
	})

	it("missing state is simply absent, not an error", async () => {
		const dir = mkdtempSync(join(tmpdir(), "compaction-empty-"))
		try {
			assert.equal(await loadCompactionState(dir), undefined)
			assert.equal(isCompactionStateValid(undefined, history), false)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
