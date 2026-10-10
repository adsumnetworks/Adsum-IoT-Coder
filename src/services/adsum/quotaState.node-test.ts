import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { quotaState } from "./quotaState"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/adsum/quotaState.node-test.ts
 */
describe("quotaState — one state the UI renders from the raw free-tier signals", () => {
	test("plenty remaining is ok", () => {
		assert.deepEqual(quotaState(6_000_000), { kind: "ok", remaining: 6_000_000 })
	})

	test("undefined remaining (not on the free tier, or nothing reported yet) is ok", () => {
		assert.deepEqual(quotaState(undefined), { kind: "ok", remaining: undefined })
	})

	test("below the threshold is low", () => {
		assert.deepEqual(quotaState(99_999), { kind: "low", remaining: 99_999 })
	})

	test("exactly at the threshold is still ok", () => {
		assert.deepEqual(quotaState(100_000), { kind: "ok", remaining: 100_000 })
	})

	test("zero remaining is spent", () => {
		assert.deepEqual(quotaState(0), { kind: "spent", remaining: 0 })
	})

	test("a 429 with a retry-after is limited, with resetsAt computed from now", () => {
		const now = new Date("2026-10-10T12:00:00.000Z")
		const result = quotaState(50_000, { status: 429, retryAfterSeconds: 30 }, now)
		assert.equal(result.kind, "limited")
		assert.equal(result.remaining, 50_000)
		assert.equal(result.resetsAt, "2026-10-10T12:00:30.000Z")
	})

	test("a 402 with no retry-after is limited, with no resetsAt", () => {
		const result = quotaState(0, { status: 402 })
		assert.equal(result.kind, "limited")
		assert.equal(result.resetsAt, undefined)
	})

	test("limited wins over spent — a 402 takes priority over the raw zero balance", () => {
		const result = quotaState(0, { status: 402, retryAfterSeconds: 3600 })
		assert.equal(result.kind, "limited")
	})

	test("limited wins over low too", () => {
		const result = quotaState(50_000, { status: 429, retryAfterSeconds: 10 })
		assert.equal(result.kind, "limited")
	})
})
