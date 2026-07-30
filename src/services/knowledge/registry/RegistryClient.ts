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
	const env = process.env.ADSUM_AUTHOR_TOKEN
	if (env && env.trim()) {
		return env.trim()
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
}
