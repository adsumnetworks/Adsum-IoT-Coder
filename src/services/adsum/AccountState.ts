import { randomBytes } from "node:crypto"
import { ClineEnv } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { getInstallId } from "./InstallIdentity"

/**
 * The developer's account, as the extension holds it.
 *
 * WHAT LIVES WHERE, AND WHY. The bearer goes in `context.secrets` (the OS keychain) because it is a
 * live credential; the profile and the entitlement groups go in globalState because they are neither
 * secret nor worth a keychain round trip on every paint. Nothing here is the enforcement — the
 * registry decides what may be read, and this cache exists so the UI can render a locked card without
 * a network call. A tampered cache buys nothing: the fetch still 402s.
 *
 * WHY A `state` NONCE. Sign-in leaves the machine (a browser) and comes back through a `vscode://`
 * URL anyone could construct. The nonce is generated here, travels in the URL we opened, and is
 * checked again by the backend at exchange time — so a callback from a flow this extension did not
 * start is refused rather than silently signing the developer into a stranger's account.
 */

/** How long a cached profile is trusted before a refresh is attempted. Offline keeps the last one. */
const REFRESH_MS = 60 * 60 * 1000

export interface AccountProfile {
	email: string
	name: string
	emailVerified: boolean
	/** Entitlement groups this account holds. `all` satisfies every group. */
	groups: string[]
	/** Families with a template-source request still open, as the SERVER sees it. Rendering "request
	 *  sent" from this rather than from a local flag is what makes a second machine agree, and what
	 *  makes a decided request stop showing as pending without anyone clicking.
	 *  OPTIONAL: a profile cached before this field existed must still load, and an older backend
	 *  simply does not send it — neither is a reason to sign anyone out. */
	openRequests?: string[]
	/** When this snapshot was taken (ms since epoch) — drives the hourly refresh, not the UI. */
	fetchedAt: number
}

type Listener = (profile: AccountProfile | null) => void

let cached: AccountProfile | null = null
let token: string | undefined
/**
 * The sign-in in flight. Held in globalState (shared by every window) with this as a local mirror,
 * because the window that STARTS a sign-in is frequently not the one that finishes it: the browser
 * hands the callback back through a `vscode://` URL and the OS routes that to a window of its
 * choosing. With more than one open — the normal case — the receiving window had no nonce to match
 * and refused a callback that was perfectly legitimate, so a completed browser sign-in did nothing.
 * Reported from the bench, 6 Sep: "it is coming back to a different vs code window".
 */
let pendingState: { nonce: string; at: number } | undefined

/** Read the pending sign-in, preferring the shared store so ANY window can complete the round trip. */
function readPendingState(): { nonce: string; at: number } | undefined {
	if (!ready) {
		return pendingState
	}
	try {
		return store().getGlobalStateKey("adsumPendingSignIn") ?? pendingState
	} catch {
		return pendingState
	}
}

function writePendingState(next: { nonce: string; at: number } | undefined): void {
	pendingState = next
	if (!ready) {
		return
	}
	try {
		store().setGlobalState("adsumPendingSignIn", next)
	} catch (e) {
		// A sign-in that cannot record its nonce still works in the window that started it; it just
		// loses the cross-window hand-back. Never fail the sign-in over it.
		Logger.warn(`[account] could not persist the pending sign-in: ${e instanceof Error ? e.message : String(e)}`)
	}
}
let ready = false
const listeners: Listener[] = []

/** StateManager owns persistence (keychain for the bearer, globalState for the profile). */
const store = () => StateManager.get()

export function initAccountState(): void {
	ready = true
	try {
		cached = store().getGlobalStateKey("adsumAccountProfile") ?? null
		token = store().getSecretKey("adsumSessionToken") || undefined
	} catch {
		// Before StateManager is initialised (a very early activation path) there is simply no account
		// yet — never a crash on a surface that has to paint.
		return
	}
	// A profile with no token is the residue of a sign-out that did not finish; the token is the truth.
	if (!token && cached) {
		void clear()
	} else if (token) {
		void refresh()
	}
}

export function onAccountChanged(listener: Listener): () => void {
	listeners.push(listener)
	return () => {
		const i = listeners.indexOf(listener)
		if (i !== -1) {
			listeners.splice(i, 1)
		}
	}
}

function notify(): void {
	for (const l of listeners) {
		try {
			l(cached)
		} catch {
			/* a listener that throws must not stop the others, or one bad card blanks the panel */
		}
	}
}

/** The profile for the webview. null ⇒ nobody is signed in. Never throws. */
export function getAccount(): AccountProfile | null {
	return cached
}

/** The bearer for RegistryClient. undefined ⇒ send no Authorization header at all. */
export function getSessionToken(): string | undefined {
	return token
}

/** True when the account holds this entitlement group (or `all`). Cheap; used to render locks. */
export function hasGroup(group: string | undefined): boolean {
	if (!group) {
		return true // ungrouped ⇒ free to everyone
	}
	const groups = cached?.groups ?? []
	return groups.includes("all") || groups.includes(group)
}

// ── sign-in ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The URL to open in the system browser, and the nonce that ties the round trip to this machine.
 * The editor scheme travels with it so the "Open …" button at the far end names the right editor —
 * VS Code, Cursor and Windsurf all have their own, and guessing wrong strands the developer in a tab.
 */
export function buildSignInUrl(provider: "github" | "google" | "email", editorScheme: string, windowId?: string): string {
	const nonce = randomBytes(24).toString("base64url")
	writePendingState({ nonce, at: Date.now() })
	const base = ClineEnv.config().adsumApiBaseUrl.replace(/\/$/, "")
	const q = new URLSearchParams({ provider, redirect: editorScheme, state: nonce })
	// Which window to come back to. `vscode://` names the application only, so without this the editor
	// delivers the callback to whichever window it likes — which is not, in general, the one the
	// developer pressed the button in. The backend puts it back as `windowId` on the callback URL.
	if (windowId && /^\d{1,10}$/.test(windowId)) {
		q.set("window", windowId)
	}
	try {
		q.set("install_id", getInstallId())
	} catch {
		/* an install id is a convenience for linking history, never a requirement to sign in */
	}
	return `${base}/auth/start?${q.toString()}`
}

/**
 * The `vscode://…/auth/callback` half. Returns false — with a reason logged — rather than throwing,
 * because the caller is a URI handler and a thrown error there is invisible to the developer.
 */
export async function completeSignIn(code: string, state: string): Promise<boolean> {
	const pending = readPendingState()
	if (!pending || pending.nonce !== state) {
		Logger.warn("[account] sign-in callback did not match any sign-in in flight — ignoring")
		return false
	}
	// One callback per attempt: a replayed URL must not mint a second session. Cleared in the SHARED
	// store, so a replay cannot be spent again by a different window either.
	writePendingState(undefined)
	try {
		const base = ClineEnv.config().adsumApiBaseUrl.replace(/\/$/, "")
		const body: Record<string, string> = { code, state }
		try {
			body.install_id = getInstallId()
		} catch {
			/* optional */
		}
		const res = await fetch(`${base}/v1/auth/exchange`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			Logger.warn(`[account] exchange failed: ${res.status}`)
			return false
		}
		const data = (await res.json()) as {
			token?: string
			email?: string
			name?: string
			email_verified?: boolean
			groups?: string[]
			open_requests?: string[]
		}
		if (!data.token) {
			return false
		}
		token = data.token
		persistToken(data.token)
		cached = {
			email: data.email ?? "",
			name: data.name ?? "",
			emailVerified: !!data.email_verified,
			groups: Array.isArray(data.groups) ? data.groups : [],
			// The backend has always sent this; nobody read it, so "request sent" could never render on
			// the card that offers the request. An open request is the one piece of account state a
			// developer looks for after they ask for source.
			openRequests: Array.isArray(data.open_requests) ? data.open_requests : [],
			fetchedAt: Date.now(),
		}
		persistProfile(cached)
		// The far end of the funnel: gate_shown → signin_started → HERE. `groups` is a count, not a
		// list — how much a new account opens is the interesting number; which grants they hold is not
		// telemetry's business.
		telemetryService.captureSignInCompleted({ groups: cached.groups.length })
		notify()
		return true
	} catch (e) {
		Logger.warn(`[account] exchange threw: ${e instanceof Error ? e.message : String(e)}`)
		return false
	}
}

/**
 * Re-read the profile. Offline keeps the last one — a developer on a train has not been signed out,
 * and locking their cards because the wifi dropped would be a lie about why.
 */
export async function refresh(force = false): Promise<void> {
	if (!token) {
		return
	}
	if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
		return
	}
	try {
		const base = ClineEnv.config().adsumApiBaseUrl.replace(/\/$/, "")
		const res = await fetch(`${base}/v1/me`, { headers: { Authorization: `Bearer ${token}` } })
		if (res.status === 401) {
			// The server revoked or expired it. That IS a sign-out, and pretending otherwise would leave
			// cards unlocked that no longer resolve.
			Logger.info("[account] session no longer valid — signing out locally")
			await clear()
			return
		}
		if (!res.ok) {
			return
		}
		const data = (await res.json()) as {
			email?: string
			name?: string
			email_verified?: boolean
			groups?: string[]
			open_requests?: string[]
		}
		cached = {
			email: data.email ?? cached?.email ?? "",
			name: data.name ?? cached?.name ?? "",
			emailVerified: !!data.email_verified,
			groups: Array.isArray(data.groups) ? data.groups : [],
			openRequests: Array.isArray(data.open_requests) ? data.open_requests : [],
			fetchedAt: Date.now(),
		}
		persistProfile(cached)
		notify()
	} catch {
		/* offline: keep what we have */
	}
}

/** Sign out here AND on the server, so a lost machine actually loses access. */
export async function signOut(): Promise<void> {
	const had = token
	await clear()
	if (!had) {
		return
	}
	try {
		const base = ClineEnv.config().adsumApiBaseUrl.replace(/\/$/, "")
		await fetch(`${base}/v1/auth/signout`, { method: "POST", headers: { Authorization: `Bearer ${had}` } })
	} catch {
		/* the local half already happened; the server session expires on its own */
	}
}

async function clear(): Promise<void> {
	token = undefined
	cached = null
	// Through the shared store: a nonce left behind in globalState would outlive the sign-out and let
	// a stale callback land in any window afterwards.
	writePendingState(undefined)
	persistToken(undefined)
	persistProfile(undefined)
	notify()
}

/**
 * Persistence, isolated so the rest of this module never has to think about it — and so a unit test
 * can drive the account without a StateManager at all. A write that fails is logged, not thrown: the
 * developer is mid-sign-in and a storage hiccup must not read as "sign-in failed".
 */
function persistToken(next: string | undefined): void {
	if (!ready) {
		return
	}
	try {
		store().setSecret("adsumSessionToken", next)
	} catch (e) {
		Logger.warn(`[account] could not persist the session: ${e instanceof Error ? e.message : String(e)}`)
	}
}

function persistProfile(next: AccountProfile | undefined | null): void {
	if (!ready) {
		return
	}
	try {
		store().setGlobalState("adsumAccountProfile", next ?? undefined)
	} catch (e) {
		Logger.warn(`[account] could not persist the profile: ${e instanceof Error ? e.message : String(e)}`)
	}
}

/** Test seam — lets a unit test drive the module without a real ExtensionContext. */
export function __setForTest(next: { token?: string; profile?: AccountProfile | null; state?: string }): void {
	ready = false // a unit test drives the module in memory; nothing reaches StateManager
	if ("token" in next) {
		token = next.token
	}
	if ("profile" in next) {
		cached = next.profile ?? null
	}
	if (next.state) {
		pendingState = { nonce: next.state, at: Date.now() }
	}
}
