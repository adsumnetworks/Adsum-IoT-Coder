import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { ClineEnv } from "@/config"
import { ExtensionRegistryInfo } from "@/registry"
import { getInstallId } from "@/services/adsum/InstallIdentity"
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
	[k: string]: unknown
}

export interface DownloadedManifest {
	manifestVersion: number
	bits: DownloadedManifestEntry[]
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Why a tool artifact did or did not arrive. `locked` and `absent` are both 4xx but mean opposite
 * things to the caller: one is a paywall to surface, the other is "this registry does not have it"
 * (a rolled-back backend, say) which must stay silent.
 */
export type ArtifactFetch = { kind: "ok"; bytes: Buffer } | { kind: "locked" } | { kind: "absent" } | { kind: "unreachable" }

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
			const data = JSON.parse(text) as DownloadedManifest
			return Array.isArray(data?.bits) ? data : null
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
				}
				const res = await this.fetchImpl(url, {
					method: "GET",
					headers,
					signal: controller.signal,
				})
				if (res.ok) {
					return await res.text()
				}
				// 4xx = permanent (bit genuinely absent / bad request) → fail fast, no retry.
				// 5xx = transient server error → fall through to retry.
				if (res.status < 500) {
					return null
				}
			} catch {
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
				}
				const res = await this.fetchImpl(url, { method: "GET", headers, signal: controller.signal })
				if (res.ok) {
					const buf = Buffer.from(await res.arrayBuffer())
					return { kind: "ok", bytes: buf }
				}
				if (res.status === 402) {
					return { kind: "locked" }
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
