/**
 * X-01…X-08 — the extension's half of sign-in.
 *
 * The account cache is not the gate (the registry is), so what these cases protect is different: that
 * a callback this window did not start cannot sign anyone in, that a developer's history survives, and
 * that losing the network is never mistaken for losing the account.
 *
 * Run: npm run test:account
 */
import { strict as assert } from "node:assert"
import { after, before, describe, test } from "node:test"
import { setImmediate as tick } from "node:timers/promises"
import { __setTelemetryServiceForTest } from "@/services/telemetry"
import * as account from "./AccountState"

/**
 * Telemetry the module fires without awaiting. Under this test there is no editor host, so the real service
 * could not be created and five tests left a call running that rejected after they had ended — every
 * assertion passed and the file still exited 1. A recording double ends that work inside the test (see
 * `settled`), and it lets the sign-in event itself be asserted rather than merely survived.
 */
const captured: string[] = []
before(() => {
	__setTelemetryServiceForTest({
		captureSignInCompleted: (props?: { groups: number }) => void captured.push(`signin_completed:${props?.groups ?? 0}`),
	} as never)
})
after(() => __setTelemetryServiceForTest(null))
/** Let every fire-and-forget capture started by the test finish before the test returns. */
const settled = () => tick()

// Persistence lives in StateManager and is exercised by the extension's own storage tests; these
// cases drive the module in memory (`__setForTest` puts it there), because what is worth pinning
// here is the BEHAVIOUR — which callback is honoured, what a 401 means, what offline does not mean.

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

describe("X — the account, extension side", () => {
	test("X-01 the sign-in URL carries the editor and a fresh nonce every time", () => {
		const a = account.buildSignInUrl("github", "cursor")
		const b = account.buildSignInUrl("github", "cursor")
		const ua = new URL(a)
		assert.equal(ua.pathname, "/auth/start")
		assert.equal(ua.searchParams.get("provider"), "github")
		// The editor scheme decides which "Open …" button the browser page offers. Guessing it wrong
		// strands the developer in a tab with a link that does nothing.
		assert.equal(ua.searchParams.get("redirect"), "cursor")
		const state = ua.searchParams.get("state") ?? ""
		assert.ok(state.length >= 16, "state must be long enough to be unguessable")
		assert.notEqual(state, new URL(b).searchParams.get("state"), "a nonce must never be reused")
	})

	test("X-02 a callback that does not match this window's nonce is refused", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "the-real-nonce" })
		let called = false
		const out = await withFetch(
			(async () => {
				called = true
				return json({ token: "adu_should-never-be-minted" })
			}) as typeof fetch,
			() => account.completeSignIn("some-code", "a-different-nonce"),
		)
		assert.equal(out, false)
		assert.equal(called, false, "a mismatched callback must not even reach the network")
		assert.equal(account.getSessionToken(), undefined)
	})

	test("X-03 a matching callback stores the bearer and the profile", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "nonce-abc" })
		const ok = await withFetch(
			(async () =>
				json({
					token: "adu_live",
					email: "dev@example.com",
					name: "Dev",
					email_verified: true,
					groups: ["cellular-advanced"],
				})) as typeof fetch,
			() => account.completeSignIn("code-1", "nonce-abc"),
		)
		assert.equal(ok, true)
		assert.equal(account.getSessionToken(), "adu_live")
		assert.equal(account.getAccount()?.email, "dev@example.com")
		assert.equal(account.getAccount()?.groups.length, 1)
		await settled()
		assert.ok(captured.includes("signin_completed:1"), "a completed sign-in is counted, with how many groups it opened")
	})

	/**
	 * B22, 14 Sep. Every window of one editor profile shares the stored session and profile. The bench window
	 * signed in; another window of the same profile still held its own older account in memory, and wrote that
	 * back. A window must take the stored session as the truth before it writes anything.
	 */
	test("X-22a a window holding an older session adopts the stored one and never writes its own back", async () => {
		account.__setForTest({
			token: "adu_older_window_session_aaaaaaaa",
			profile: { email: "older@example.com", name: "", emailVerified: true, groups: ["all"], fetchedAt: 0 },
		})
		account.setStoredSessionTokenReader(async () => "adu_just_signed_in_elsewhere_bbbb")
		const bearers: string[] = []
		try {
			await withFetch(
				(async (_url: string | URL, init?: RequestInit) => {
					const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "")
					bearers.push(auth)
					return auth.endsWith("bbbb")
						? json({ email: "bench@example.com", groups: ["cellular-advanced"] })
						: json({ email: "older@example.com", groups: ["all"] })
				}) as typeof fetch,
				() => account.refresh(true),
			)
			await settled()
			assert.equal(account.getSessionToken(), "adu_just_signed_in_elsewhere_bbbb")
			assert.equal(account.getAccount()?.email, "bench@example.com")
			assert.ok(!bearers.some((b) => b.endsWith("aaaaaaaa")), "the stale session must not be used or written back")
		} finally {
			account.setStoredSessionTokenReader(undefined)
		}
	})

	test("X-22b a sign-out in another window signs this one out, without this window deleting anything", async () => {
		account.__setForTest({
			token: "adu_live_session_cccccccccccccccc",
			profile: { email: "dev@example.com", name: "", emailVerified: true, groups: [], fetchedAt: Date.now() },
		})
		account.sessionTokenChangedElsewhere(undefined)
		assert.equal(account.getSessionToken(), undefined)
		assert.equal(account.getAccount(), null)
	})

	test("X-09 an open access request survives sign-in and refresh", async () => {
		// The backend has always sent `open_requests`; neither completeSignIn nor refresh read it, so
		// `openRequests` was permanently [] and the card that offers "request template source" could
		// never show that one had been sent. A person asked, saw nothing change, and asked again.
		account.__setForTest({ token: undefined, profile: null, state: "nonce-req" })
		await withFetch(
			(async () =>
				json({
					token: "adu_req",
					email: "dev@example.com",
					name: "Dev",
					email_verified: true,
					groups: ["cellular-advanced"],
					open_requests: ["lew840x"],
				})) as typeof fetch,
			() => account.completeSignIn("code-r", "nonce-req"),
		)
		assert.deepEqual(account.getAccount()?.openRequests, ["lew840x"], "the exchange carries it")

		await withFetch(
			(async () =>
				json({
					email: "dev@example.com",
					name: "Dev",
					email_verified: true,
					groups: [],
					open_requests: ["lew840x", "blg20"],
				})) as typeof fetch,
			// force: the profile was cached a millisecond ago and refresh rightly short-circuits on that.
			() => account.refresh(true),
		)
		assert.deepEqual(account.getAccount()?.openRequests, ["lew840x", "blg20"], "and the hourly refresh keeps it current")
		await settled()
	})

	test("X-10 a callback that lands in a DIFFERENT window still completes the sign-in", async () => {
		// Reported from the bench, 6 Sep: "it is coming back to a different vs code window". The browser
		// hands the callback back through a vscode:// URL and the OS routes it to a window of its
		// choosing — with more than one open, usually not the one that started the sign-in. The nonce
		// used to live in that window's memory, so the receiving window had nothing to match and
		// refused a callback that was entirely legitimate: the browser said "signed in", the editor
		// did nothing, and the log blamed the callback.
		//
		// __setForTest drives the module in memory, which is precisely the window-local case: what this
		// asserts is that completeSignIn matches on the nonce it can READ, not on one a particular
		// window happens to hold in a local variable.
		account.__setForTest({ token: undefined, profile: null, state: "nonce-window-A" })
		const ok = await withFetch(
			(async () =>
				json({
					token: "adu_cross_window",
					email: "dev@example.com",
					name: "Dev",
					email_verified: true,
					groups: ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex", "blg20-demo-hex"],
				})) as typeof fetch,
			() => account.completeSignIn("code-cross", "nonce-window-A"),
		)
		assert.equal(ok, true, "the nonce matched, so the exchange must proceed")
		assert.equal(account.getSessionToken(), "adu_cross_window")
		// And what it hands back is the free tier, which is what unlocks the cards in EVERY window —
		// the bearer and profile both live in shared storage.
		assert.deepEqual(account.getAccount()?.groups.sort(), [
			"blg20-demo-hex",
			"cellular-advanced",
			"edge-ai-advanced",
			"lew840x-demo-hex",
		])
		await settled()
	})

	test("X-04 one callback per attempt — a replayed URL cannot mint a second session", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "nonce-once" })
		const call = () =>
			withFetch((async () => json({ token: "adu_x", email: "a@b.c", groups: [] })) as typeof fetch, () =>
				account.completeSignIn("code", "nonce-once"),
			)
		assert.equal(await call(), true)
		assert.equal(await call(), false, "the nonce is spent by the first callback")
		await settled()
	})

	test("X-05 hasGroup answers the lock, and `all` satisfies everything", () => {
		account.__setForTest({
			profile: { email: "", name: "", emailVerified: true, groups: ["cellular-advanced"], fetchedAt: Date.now() },
		})
		assert.equal(account.hasGroup(undefined), true, "an ungrouped bit is free to everyone")
		assert.equal(account.hasGroup("cellular-advanced"), true)
		assert.equal(account.hasGroup("lew840x-ble-src"), false)

		account.__setForTest({ profile: { email: "", name: "", emailVerified: true, groups: ["all"], fetchedAt: Date.now() } })
		assert.equal(account.hasGroup("lew840x-9160-src"), true)

		account.__setForTest({ profile: null })
		assert.equal(account.hasGroup("cellular-advanced"), false)
		assert.equal(account.hasGroup(undefined), true)
	})

	test("X-06 a 401 from /v1/me signs out; anything else leaves the account alone", async () => {
		const signedIn = { email: "x@y.z", name: "X", emailVerified: true, groups: ["cellular-advanced"], fetchedAt: 0 }

		// A revoked session is a real sign-out: leaving cards unlocked that no longer resolve would be
		// worse than saying so.
		account.__setForTest({ token: "adu_revoked", profile: { ...signedIn } })
		await withFetch((async () => json({ error: "session_expired" }, 401)) as typeof fetch, () => account.refresh(true))
		assert.equal(account.getAccount(), null)
		assert.equal(account.getSessionToken(), undefined)

		// Offline is NOT a sign-out. A developer on a train has not lost their account.
		account.__setForTest({ token: "adu_live", profile: { ...signedIn } })
		await withFetch(
			(async () => {
				throw new Error("getaddrinfo ENOTFOUND")
			}) as typeof fetch,
			() => account.refresh(true),
		)
		assert.equal(account.getAccount()?.email, "x@y.z", "an offline refresh keeps the last known profile")

		// A 5xx is the server's problem, not the developer's.
		account.__setForTest({ token: "adu_live", profile: { ...signedIn } })
		await withFetch((async () => json({}, 503)) as typeof fetch, () => account.refresh(true))
		assert.equal(account.getAccount()?.email, "x@y.z")
	})

	test("X-07 refresh picks up a group that was granted since sign-in", async () => {
		account.__setForTest({
			token: "adu_live",
			profile: { email: "g@h.i", name: "", emailVerified: true, groups: ["cellular-advanced"], fetchedAt: 0 },
		})
		assert.equal(account.hasGroup("lew840x-ble-src"), false)
		await withFetch(
			(async () =>
				json({ email: "g@h.i", email_verified: true, groups: ["cellular-advanced", "lew840x-ble-src"] })) as typeof fetch,
			() => account.refresh(true),
		)
		assert.equal(account.hasGroup("lew840x-ble-src"), true, "a grant made in the admin page must arrive without a restart")
	})

	test("X-08 sign-out clears the keychain and tells the server, and survives the server being down", async () => {
		account.__setForTest({ token: undefined, profile: null, state: "nonce-out" })
		await withFetch((async () => json({ token: "adu_bye", email: "z@z.z", groups: [] })) as typeof fetch, () =>
			account.completeSignIn("c", "nonce-out"),
		)
		assert.equal(account.getSessionToken(), "adu_bye")

		let calledSignout = false
		await withFetch(
			(async (_url: string) => {
				calledSignout = true
				throw new Error("server down")
			}) as unknown as typeof fetch,
			() => account.signOut(),
		)
		assert.equal(calledSignout, true, "sign-out must reach the server so a lost machine loses access")
		// The local half happens regardless: a failed round trip must not leave the editor holding a
		// token it believes is live.
		assert.equal(account.getSessionToken(), undefined)
		assert.equal(account.getAccount(), null)
		await settled()
	})

	/**
	 * X-11 — the sign-in URL says which WINDOW to come back to.
	 *
	 * Reported from a real desk, twice: the hand-off opened in a different VS Code window from the one
	 * the developer pressed Register in. `vscode://` names an application, not a window; VS Code routes
	 * on a `windowId` it will only see if we send one. This is the editor's half — the id goes out on
	 * `/auth/start` as `window`, and the backend puts it back on the callback (backend A-23).
	 */
	test("X-11 the sign-in URL carries this window, and refuses anything that is not one", () => {
		const withWindow = new URL(account.buildSignInUrl("email", "vscode", "3"))
		assert.equal(withWindow.searchParams.get("window"), "3")

		// No id is a legitimate answer — a host that cannot say (or an older editor) still signs in, and
		// completeSignIn survives the callback landing elsewhere because the pending nonce is shared.
		assert.equal(new URL(account.buildSignInUrl("email", "vscode")).searchParams.get("window"), null)

		// A window id is pasted into a URL the browser follows. Anything that is not plain digits is
		// dropped rather than escaped, so there is no encoding to get wrong later.
		for (const bad of ["3&code=stolen", "../..", "", "1e3", "99999999999"]) {
			assert.equal(
				new URL(account.buildSignInUrl("email", "vscode", bad)).searchParams.get("window"),
				null,
				`"${bad}" must not travel as a window id`,
			)
		}
	})
})
