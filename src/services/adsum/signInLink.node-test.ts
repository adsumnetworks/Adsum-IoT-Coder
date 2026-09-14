/**
 * Sign-in that finishes in the window that started it.
 *
 * The OS may hand the browser's `vscode://` link to another window, another editor profile or another editor.
 * The window holding the sign-in's state polls the server and finishes by itself; a callback that lands where
 * no sign-in is pending exchanges nothing. A pasted link is the last resort, through the same exchange.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/services/adsum/signInLink.node-test.ts
 */
import { strict as assert } from "node:assert"
import { after, before, describe, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { __setTelemetryServiceForTest } from "@/services/telemetry"
import * as account from "./AccountState"
import { SIGN_IN_ELSEWHERE_TEXT, setSignInElsewhereSurface, signInElsewhereNotice } from "./signInElsewhere"
import { PASTE_MESSAGES, parseSignInLink, pasteSignInLink } from "./signInLink"

before(() => __setTelemetryServiceForTest({ captureSignInCompleted: () => {} } as never))
after(() => __setTelemetryServiceForTest(null))

const CODE = "Zk3q9xYw2Lr8Tn5Vb1Hc7Pd4Sf6Ga0Je"
const STATE = "Qm2Wn8Er4Ty6Ui0Op3As5Df7Gh9Jk1Lz"

const withFetch = async <T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> => {
	const real = globalThis.fetch
	globalThis.fetch = impl
	try {
		return await fn()
	} finally {
		globalThis.fetch = real
	}
}
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("P — pasting a sign-in link", () => {
	test("P-01 parses the full link, the insiders link, and the query alone", () => {
		const full = `vscode://AdsumNetwork.nrf-ai-debugger/auth/callback?code=${CODE}&state=${STATE}&windowId=3`
		assert.deepEqual(parseSignInLink(full), { code: CODE, state: STATE })
		assert.deepEqual(
			parseSignInLink(`  vscode-insiders://adsumnetwork.nrf-ai-debugger/auth/callback?code=${CODE}&state=${STATE} `),
			{
				code: CODE,
				state: STATE,
			},
		)
		assert.deepEqual(parseSignInLink(`code=${CODE}&state=${STATE}`), { code: CODE, state: STATE })
		assert.deepEqual(parseSignInLink(`?state=${STATE}&code=${CODE}`), { code: CODE, state: STATE })
	})

	test("P-02 refuses garbage, a truncated link, another path and another scheme", () => {
		for (const bad of [
			"",
			"hello",
			"vscode://adsumnetwork.nrf-ai-d...d%3D1",
			`https://evil.example/auth/callback?code=${CODE}&state=${STATE}`,
			`vscode://AdsumNetwork.nrf-ai-debugger/openrouter?code=${CODE}&state=${STATE}`,
			`code=${CODE}`,
			`code=short&state=${STATE}`,
		]) {
			assert.equal(parseSignInLink(bad), null, bad)
		}
	})

	test("P-03 a link for a sign-in started in another window is refused, and nothing is exchanged", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "this-windows-own-state-000" })
		let calls = 0
		const out = await withFetch(
			(async () => {
				calls++
				return json({ token: "adu_never" })
			}) as typeof fetch,
			() => pasteSignInLink(`vscode://AdsumNetwork.nrf-ai-debugger/auth/callback?code=${CODE}&state=${STATE}`),
		)
		assert.deepEqual(out, { ok: false, message: PASTE_MESSAGES.otherWindow })
		assert.equal(calls, 0)
		assert.equal(account.getSessionToken(), undefined)
	})

	test("P-04 a matching link exchanges once, through the same exchange the callback uses", async () => {
		account.__setForTest({ token: undefined, profile: null, state: STATE })
		const urls: string[] = []
		const out = await withFetch(
			(async (url: string | URL) => {
				urls.push(String(url))
				return json({ token: "adu_pasted", email: "dev@example.com", groups: [] })
			}) as typeof fetch,
			() => pasteSignInLink(`code=${CODE}&state=${STATE}`),
		)
		assert.equal(out.ok, true)
		assert.equal(urls.length, 1)
		assert.match(urls[0], /\/v1\/auth\/exchange$/)
		assert.equal(account.getSessionToken(), "adu_pasted")
	})

	test("P-05 an expired or used link says so", async () => {
		account.__setForTest({ token: undefined, profile: null, state: STATE })
		const out = await withFetch((async () => json({ error: "code_invalid" }, 401)) as typeof fetch, () =>
			pasteSignInLink(`code=${CODE}&state=${STATE}`),
		)
		assert.deepEqual(out, { ok: false, message: PASTE_MESSAGES.expired })
	})
})

describe("W — the window that started sign-in finishes it", () => {
	test("W-01 polls while pending, finishes on the claim, and stops", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "poll-state-w01-aaaaaaaaaaaa" })
		const seen: string[] = []
		let n = 0
		await withFetch(
			(async (url: string | URL, init?: RequestInit) => {
				seen.push(`${String(url).replace(/^.*\/v1/, "/v1")} ${init?.body}`)
				n++
				return n < 3
					? json({ status: "pending" }, 202)
					: json({ token: "adu_claimed", email: "dev@example.com", groups: [] })
			}) as typeof fetch,
			async () => {
				account.startSignInClaimPoll({ intervalMs: 5, maxMs: 2000 })
				await sleep(120)
			},
		)
		assert.equal(account.getSessionToken(), "adu_claimed")
		assert.equal(n, 3, "two pending answers, one claim, then no more requests")
		assert.ok(
			seen.every((s) => s.startsWith("/v1/auth/claim ") && s.includes("poll-state-w01")),
			seen.join("\n"),
		)
	})

	test("W-02 stops as soon as the pending sign-in is gone — the callback won, or a new sign-in began", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "poll-state-w02-bbbbbbbbbbbb" })
		let n = 0
		await withFetch(
			(async () => {
				n++
				return json({ status: "pending" }, 202)
			}) as typeof fetch,
			async () => {
				account.startSignInClaimPoll({ intervalMs: 5, maxMs: 2000 })
				await sleep(30)
				account.__setForTest({ state: "a-newer-sign-in-cccccccccccc" })
				const before = n
				await sleep(60)
				assert.ok(n <= before + 1, `kept polling an abandoned state: ${before} → ${n}`)
				account.stopSignInClaimPoll()
			},
		)
	})

	test("W-03 a used or expired sign-in ends the poll", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "poll-state-w03-dddddddddddd" })
		let n = 0
		await withFetch(
			(async () => {
				n++
				return json({ error: "gone" }, 410)
			}) as typeof fetch,
			async () => {
				account.startSignInClaimPoll({ intervalMs: 5, maxMs: 2000 })
				await sleep(80)
			},
		)
		assert.equal(n, 1)
		assert.equal(account.getSessionToken(), undefined)
	})

	test("W-04 a callback in a window with no pending sign-in exchanges nothing and says only a quiet line", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "the-window-that-started-it-eeee" })
		let calls = 0
		const outcome = await withFetch(
			(async () => {
				calls++
				return json({ token: "adu_never" })
			}) as typeof fetch,
			() => account.completeSignInResult(CODE, STATE),
		)
		assert.equal(outcome, "state_mismatch")
		assert.equal(calls, 0, "the code must stay unspent for the window that started it")
		const lines: string[] = []
		setSignInElsewhereSurface((t) => lines.push(t))
		signInElsewhereNotice()
		setSignInElsewhereSurface(undefined)
		assert.deepEqual(lines, [SIGN_IN_ELSEWHERE_TEXT])
	})
})
