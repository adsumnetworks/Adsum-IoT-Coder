import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { ClineEnv } from "@/config"
import { ExtensionRegistryInfo } from "@/registry"
import { getInstallId } from "@/services/adsum/InstallIdentity"
// The token holder, NOT `AccountState` — importing that pulled in StateManager and through it
// `vscode`, which killed every plain-node test that touched the resolver (and, from 2026-09-06,
// `npm run test:kbits` in the pre-commit hook).
import { getSessionToken } from "@/services/adsum/sessionToken"
import { getCachedWorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { getEditorIdentity } from "@/services/telemetry/editorIdentity"

/**
 * Author bearer token for the draft channel (optional). Resolution, first hit wins:
 *   1. ADSUM_AUTHOR_TOKEN env (dev / F5)
 *   2. ~/.config/adsum/author.token file (chmod 600 — the canonical, Studio-shared location)
 * When present it is sent as `Authorization: Bearer <token>` so the registry serves THIS author's
 * DRAFT versions in their manifest (everyone else gets published-only). It is NOT a security bypass —
 * the server validates it and only ever returns the token-holder's own drafts — so, unlike the
 * ADSUM_KBIT_LOCAL dev override, it is deliberately NOT IS_DEV-gated: an installed author needs it.
 */
export function resolveAuthorToken(): string | null {
	// A DEFINED but EMPTY ADSUM_AUTHOR_TOKEN means "explicitly no author" — the file must not fill in behind
	// it. On an author's own machine the token file is always present, so without this there is no way to ask
	// for the PUBLISHED corpus: every run silently folded that author's drafts in while recording itself as
	// `registry@current`. A measurement of published bits has to be able to say "published, and I mean it".
	const env = process.env.ADSUM_AUTHOR_TOKEN
	if (env !== undefined) {
		return env.trim() || null
	}
	try {
		const file = join(homedir(), ".config", "adsum", "author.token")
		if (existsSync(file)) {
			const t = readFileSync(file, "utf8").trim()
			return t || null
		}
	} catch {
		// unreadable file → simply not an author on this machine
	}
	return null
}

/**
 * RegistryClient — read-only access to the K-bit registry (P2). Fetches the **downloadable**
 * manifest and **content-addressed** bit blobs from `{adsumApiBaseUrl}/v1/kbits/*`.
 *
 * Every method is **offline-safe**: any network / HTTP / parse failure returns `null` so the
 * KnowledgeResolver falls back to cache → bundled and never throws into the prompt build. The base
 * URL + `fetch` impl are injectable so this is unit-testable without a network.
 *
 * Backend contract (implemented later in `Adsum-Backend`):
 *   GET /v1/kbits/manifest          → { manifestVersion, bits: [{ id, version, content_hash, ... }] }
 *   GET /v1/kbits/blob/{hash}       → the bit's raw .md body (immutable, content-addressed)
 */

export interface DownloadedManifestEntry {
	id: string
	version: string
	content_hash: string
	path?: string
	/** SPDX-ish license id. Drives the on-disk cache policy: open licenses may be cached as
	 *  plaintext; anything else (proprietary) is served from the fetch but not persisted (see P5). */
	license?: string
	// Attribution, served by /v1/kbits/manifest. These MUST come from the catalog, not the blob: the
	// publisher strips frontmatter before hashing (content_hash = sha256(body)), so a downloaded bit's
	// body carries no author at all.
	title?: string
	type?: string
	author?: string
	platform?: string
	owner?: string
	/** The entitlement group this bit needs, when it has one. Absent ⇒ free to everyone. */
	group?: string
	[k: string]: unknown
}

export interface DownloadedManifest {
	manifestVersion: number
	/** Rows this account can fetch. Every one carries a `content_hash` — nothing else reaches here. */
	bits: DownloadedManifestEntry[]
	/** Bits that exist and are not this account's yet: known, never fetchable. */
	locked?: LockedManifestEntry[]
}

/**
 * A manifest row for a bit this account cannot open (registry, from client 0.4.1): identity and the
 * group that would open it — no hash, no size, no title. It says "this exists and is locked", which is
 * the one thing the client could not tell apart from "never published" before these rows existed.
 */
export interface LockedManifestEntry {
	id: string
	version: string
	group: string | null
	locked: true
}

/**
 * Split a raw manifest into fetchable rows and locked rows.
 *
 * The ONE place a manifest row is sorted. A locked row has no `content_hash`; left among the fetchable
 * rows it would be indexed by id and fetched as `blob/undefined`, and a 404 there reads to the developer
 * as a broken registry. So a row reaches `bits` only if it carries a string hash and is not locked; a
 * locked row goes to `locked`; anything else malformed is dropped.
 */
export function splitManifestRows(raw: unknown): DownloadedManifest | null {
	const data = raw as { manifestVersion?: unknown; bits?: unknown; locked?: unknown } | null
	if (!data || !Array.isArray(data.bits)) {
		return null
	}
	const bits: DownloadedManifestEntry[] = []
	const locked = new Map<string, LockedManifestEntry>()
	const takeLocked = (r: Record<string, unknown>) => {
		if (typeof r.id === "string" && r.id) {
			locked.set(r.id, {
				id: r.id,
				version: typeof r.version === "string" ? r.version : "",
				group: typeof r.group === "string" ? r.group : null,
				locked: true,
			})
		}
	}
	for (const row of data.bits as Array<Record<string, unknown> | null>) {
		if (!row || typeof row !== "object") continue
		if (row.locked === true) {
			takeLocked(row)
		} else if (typeof row.id === "string" && typeof row.content_hash === "string" && row.content_hash) {
			bits.push(row as DownloadedManifestEntry)
		}
	}
	// A cached catalog written by this client already carries the split.
	if (Array.isArray(data.locked)) {
		for (const row of data.locked as Array<Record<string, unknown> | null>) {
			if (row && typeof row === "object") takeLocked(row)
		}
	}
	for (const b of bits) locked.delete(b.id) // a fetchable row always wins
	return {
		manifestVersion: typeof data.manifestVersion === "number" ? data.manifestVersion : 1,
		bits,
		...(locked.size ? { locked: [...locked.values()] } : {}),
	}
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Why a tool artifact did or did not arrive. `locked` and `absent` are both 4xx but mean opposite
 * things to the caller: one is a paywall to surface, the other is "this registry does not have it"
 * (a rolled-back backend, say) which must stay silent.
 */
export type ArtifactFetch =
	| { kind: "ok"; bytes: Buffer }
	| { kind: "locked" }
	| { kind: "auth" }
	| { kind: "absent" }
	| { kind: "unreachable" }

/**
 * Thrown by the text path when the registry answers 402: the bit exists and is simply not this
 * account's yet. An exception rather than a null because every existing caller of `get()` already
 * reads null as "no such bit", and those two must never be confused at any of those call sites.
 */
export class RegistryLockedError extends Error {
	constructor(public readonly path: string) {
		super(`registry: entitlement required for ${path}`)
		this.name = "RegistryLockedError"
	}
}

/**
 * Thrown when the registry answers 401 or 403: the credential sent was refused. That is a sign-in that has
 * expired or been revoked — never a network blip. Retrying cannot change it, and telling the developer "the
 * registry is unreachable" sends them to check a connection that works.
 */
export class RegistryAuthError extends Error {
	constructor(
		public readonly path: string,
		public readonly status: number,
	) {
		super(`registry: credential refused (${status}) for ${path}`)
		this.name = "RegistryAuthError"
	}
}

export class RegistryClient {
	constructor(
		private readonly baseUrl: string = ClineEnv.config().adsumApiBaseUrl,
		private readonly fetchImpl: FetchLike = fetch,
		private readonly timeoutMs = 5000,
		/** Total attempts per request. A single transient blip (timeout / network drop / 5xx) used to make a
		 *  downloaded bit "vanish" → the agent then improvised the workflow from memory. Bounded retry closes
		 *  that: 3 attempts with linear backoff. 4xx (bit genuinely absent) is NOT retried — it fails fast. */
		private readonly maxAttempts = 3,
		private readonly retryBackoffMs = 250,
		/** Optional draft-channel author token. Default resolves env → ~/.config/adsum/author.token.
		 *  Injectable (and defaultable to null) so unit tests never pick up a real token. */
		private readonly authorToken: string | null = resolveAuthorToken(),
	) {}

	/** The downloadable catalog, or null if unreachable/malformed. */
	async fetchManifest(): Promise<DownloadedManifest | null> {
		// Send our app version so the registry serves the latest version of each bit COMPATIBLE with this
		// client (a bit version may declare `min_ext` = the minimum app it needs). Omitting it would make the
		// server fall back to universal-only bits. The version is baked at build time (ExtensionRegistryInfo).
		const ext = encodeURIComponent(ExtensionRegistryInfo.version)
		const text = await this.get(`/v1/kbits/manifest?ext=${ext}`)
		if (text === null) {
			return null
		}
		try {
			return splitManifestRows(JSON.parse(text))
		} catch {
			return null
		}
	}

	/**
	 * Is this bit LOCKED, or does it genuinely not exist?
	 *
	 * The manifest cannot answer. A bit this caller may not read is left out of it entirely — correctly,
	 * since listing it would publish its content hash — so "locked" and "never published" arrive here as
	 * the same silence. We then said the wrong thing: on 2026-09-10 a run told a developer that
	 * `products/fanstel/lew840x/beats/b0-pitch` was "not bundled and not in the registry", and offered
	 * to wait while they PUBLISHED it to our own registry. The bit was fine. They had no account.
	 *
	 * So we ask about the one id we already tried to read. The answer carries no hash, no title and no
	 * listing — only whether that id is locked and which grant opens it.
	 *
	 * Null on any doubt (unreachable, malformed, 404). The caller keeps its existing "not found"
	 * wording in that case, which is the honest answer when we cannot establish otherwise.
	 */
	async fetchGateStatus(bitId: string): Promise<{ locked: boolean; group: string | null; needsExt: string | null } | null> {
		const ext = encodeURIComponent(ExtensionRegistryInfo.version)
		const text = await this.get(`/v1/kbits/gate?id=${encodeURIComponent(bitId)}&ext=${ext}`)
		if (text === null) {
			return null
		}
		try {
			const d = JSON.parse(text) as { known?: boolean; locked?: boolean; group?: string | null; needsExt?: string | null }
			if (d?.known !== true || typeof d.locked !== "boolean") {
				return null
			}
			return { locked: d.locked, group: d.group ?? null, needsExt: d.needsExt ?? null }
		} catch {
			return null
		}
	}

	/**
	 * The credit roster: who to link next to a name. Null if unreachable — the caller keeps the bundled
	 * baseline, so a network blip costs a link and never a credit.
	 *
	 * This lives in the registry rather than in the extension because a profile URL is data about a
	 * PERSON, and hardcoding it meant a new contributor could not be credited until someone cut a
	 * release. Deliberately thin — handle, display name, link — and it carries nothing about how much
	 * anyone has published.
	 */
	async fetchPeople(): Promise<Array<{ handle: string; name: string; url: string | null }> | null> {
		const text = await this.get("/v1/kbits/people")
		if (text === null) {
			return null
		}
		try {
			const data = JSON.parse(text) as { people?: Array<{ handle?: string; name?: string; url?: string | null }> }
			if (!Array.isArray(data?.people)) {
				return null
			}
			return data.people
				.filter((p) => typeof p?.handle === "string" && typeof p?.name === "string")
				.map((p) => ({ handle: p.handle as string, name: p.name as string, url: p.url ?? null }))
		} catch {
			return null
		}
	}

	/** A content-addressed bit body, or null if unreachable. Integrity is verified by the caller. */
	async fetchBlob(contentHash: string): Promise<string | null> {
		return this.get(`/v1/kbits/blob/${encodeURIComponent(contentHash)}`)
	}

	/** Anonymous identity headers so the registry can attribute its high-volume events (manifest/blob fetches)
	 *  to an install and a platform — the two dimensions the 0.1.8 ops dashboard could not slice because these
	 *  server-side events had no install_id (all one synthetic person) and no iot_platform (0% coverage).
	 *  The install id is the SAME anonymous id already sent for inference/registration — no new PII. Resolved
	 *  once and fully guarded: a missing host service (e.g. the standalone core) simply omits the headers, and
	 *  the backend falls back to its old synthetic attribution. */
	private cachedIdentity?: Record<string, string>
	private identityHeaders(): Record<string, string> {
		if (this.cachedIdentity) {
			return this.cachedIdentity
		}
		const h: Record<string, string> = {}
		try {
			const id = getInstallId()
			if (id) {
				h["X-Adsum-Install"] = id
			}
		} catch {}
		try {
			const platform = getCachedWorkspaceSummary()
			if (platform) {
				h["X-Adsum-Platform"] = platform
			}
		} catch {}
		try {
			// The editor as a REQUEST HEADER, not telemetry: backend calls aren't gated by telemetry consent, so
			// this is the only way to see the editor of the many Open VSX / Cursor installs that run telemetry-off.
			const ed = getEditorIdentity()
			if (ed?.scheme) {
				h["X-Adsum-Editor"] = ed.scheme
			}
		} catch {}
		this.cachedIdentity = h
		return h
	}

	private async get(path: string): Promise<string | null> {
		const url = `${this.baseUrl}${path}`
		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), this.timeoutMs)
			try {
				const headers: Record<string, string> = { Accept: "application/json", ...this.identityHeaders() }
				// Draft channel: identify the author so the registry serves their own draft versions.
				// Harmless on blob GETs (content-addressed, public); the server only ever returns the
				// token-holder's own drafts, never anyone else's.
				if (this.authorToken) {
					headers.Authorization = `Bearer ${this.authorToken}`
				} else {
					// The signed-in developer's own bearer, when there is one. It is what decides which
					// entitlement groups the registry will serve — and so what turns a locked bit into a
					// readable one. The author token wins where both exist: that is a curator inspecting
					// their own drafts, which is a different question from what this account may read.
					const session = getSessionToken()
					if (session) {
						headers.Authorization = `Bearer ${session}`
					}
				}
				const res = await this.fetchImpl(url, {
					method: "GET",
					headers,
					signal: controller.signal,
				})
				if (res.ok) {
					return await res.text()
				}
				// 402 is not "missing" — it is "not yours yet", and the difference is the whole gate. Read
				// as absent, a locked bit looks to the developer (and to the agent) like a broken registry,
				// and the one thing they could do about it — register — is never offered.
				if (res.status === 402) {
					throw new RegistryLockedError(path)
				}
				if (res.status === 401 || res.status === 403) {
					throw new RegistryAuthError(path, res.status)
				}
				// Say which status it was: "unreachable" in a log with no number cannot be told apart from a 404.
				console.warn(`[kbit] registry answered ${res.status} for ${path}`)
				// 4xx = permanent (bit genuinely absent / bad request) → fail fast, no retry.
				// 5xx = transient server error → fall through to retry.
				if (res.status < 500) {
					return null
				}
			} catch (e) {
				// A lock or a refused credential is an answer, not a blip: never retried, never "unreachable".
				if (e instanceof RegistryLockedError || e instanceof RegistryAuthError) {
					throw e
				}
				// Network error / timeout / abort → transient → fall through to retry.
			} finally {
				clearTimeout(timer)
			}
			// Linear backoff between attempts (none after the last).
			if (attempt < this.maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs * attempt))
			}
		}
		return null
	}

	/**
	 * Fetch one tool artifact by hash, as BYTES.
	 *
	 * Deliberately not routed through `get()`: that returns text, and running `res.text()` over a
	 * binary would silently corrupt it (invalid sequences become U+FFFD, and the sha256 check would
	 * then fail on bytes that arrived intact). It also collapses every 4xx into null, which for an
	 * artifact loses the distinction that matters — 402 means "you need Pro", 404 means "not served
	 * here", and only the second is a reason to stop asking.
	 */
	async fetchArtifact(sha256: string): Promise<ArtifactFetch> {
		const url = `${this.baseUrl}/v1/kbits/artifact/${sha256}`
		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			const controller = new AbortController()
			// Artifacts are larger than bit bodies; give them a longer ceiling than a text GET.
			const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 60_000))
			try {
				const headers: Record<string, string> = { Accept: "application/octet-stream", ...this.identityHeaders() }
				if (this.authorToken) {
					headers.Authorization = `Bearer ${this.authorToken}`
				} else {
					// The signed-in developer's own bearer, when there is one. It is what decides which
					// entitlement groups the registry will serve — and so what turns a locked bit into a
					// readable one. The author token wins where both exist: that is a curator inspecting
					// their own drafts, which is a different question from what this account may read.
					const session = getSessionToken()
					if (session) {
						headers.Authorization = `Bearer ${session}`
					}
				}
				const res = await this.fetchImpl(url, { method: "GET", headers, signal: controller.signal })
				if (res.ok) {
					const buf = Buffer.from(await res.arrayBuffer())
					return { kind: "ok", bytes: buf }
				}
				if (res.status === 402) {
					return { kind: "locked" }
				}
				if (res.status === 401 || res.status === 403) {
					return { kind: "auth" }
				}
				if (res.status < 500) {
					return { kind: "absent" }
				}
			} catch {
				// transient → retry
			} finally {
				clearTimeout(timer)
			}
			if (attempt < this.maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs * attempt))
			}
		}
		return { kind: "unreachable" }
	}
}
