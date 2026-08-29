import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { SessionState } from "./askBridge"
import { checkClaim, claim, type Lease } from "./sessionLease"

/**
 * One extension host, one visible session, one fixed port. Before the lease, a second POST /task simply
 * replaced whoever was there and told nobody — which happened twice inside an hour on 2026-08-29 between
 * two of my own tasks. The point of these tests is that a collision produces an answer with a name in it.
 */
const held: Lease = { driver: "omar", taskId: "1788020564866", since: 1 }

describe("who is driving this session", () => {
	test("nobody holding it means anyone may start", () => {
		assert.deepEqual(checkClaim(null, "idle", "ismail", false), { ok: true, reason: "free" })
	})

	/**
	 * The incident: a watcher read file modification time, decided a run parked at the mistake limit had
	 * finished, and posted over it. The hardware test that run was performing was lost.
	 */
	test("a run that is only waiting for a human is still someone's run", () => {
		const v = checkClaim(held, "awaiting_human", "ismail", false)
		assert.equal(v.ok, false)
		if (v.ok) {
			return
		}
		assert.equal(v.status, 409)
		assert.equal(v.heldBy, "omar")
		assert.equal(v.taskId, "1788020564866")
		assert.match(v.error, /omar/, "the refusal must name the person, not just refuse")
		assert.match(v.error, /takeover/, "and must say how to proceed anyway")
	})

	test("a running session is held too", () => {
		assert.equal(checkClaim(held, "running", "ismail", false).ok, false)
	})

	test("takeover is allowed, because a lease is a courtesy and not a lock", () => {
		assert.deepEqual(checkClaim(held, "running", "ismail", true), { ok: true, reason: "takeover" })
	})

	test("the same driver posting again is continuing their own work", () => {
		assert.deepEqual(checkClaim(held, "running", "omar", false), { ok: true, reason: "same-driver" })
	})

	/**
	 * A finished run must not hold the session, or every driver has to remember to hand it back — and the
	 * one who forgets blocks the next person for no reason.
	 */
	test("a completed run releases the session without anyone saying so", () => {
		assert.deepEqual(checkClaim(held, "complete", "ismail", false), { ok: true, reason: "finished" })
		assert.deepEqual(checkClaim(held, "idle", "ismail", false), { ok: true, reason: "finished" })
	})

	test("an anonymous driver is still named something a human can read", () => {
		const lease = claim(undefined, "t1")
		assert.equal(lease.driver, "an unnamed driver")
		const v = checkClaim(lease, "running", "omar", false)
		assert.equal(v.ok, false)
		if (!v.ok) {
			assert.match(v.error, /an unnamed driver/)
		}
	})

	test("whitespace is not a name", () => {
		assert.equal(claim("   ", "t1").driver, "an unnamed driver")
	})

	test("every state is decided, so a new one cannot fall through silently", () => {
		const states: SessionState[] = ["idle", "running", "awaiting_human", "complete"]
		for (const state of states) {
			assert.equal(typeof checkClaim(held, state, "ismail", false).ok, "boolean", state)
		}
	})
})
