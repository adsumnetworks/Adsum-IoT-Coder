import { ClineEnv } from "@/config"
import { ExtensionRegistryInfo } from "@/registry"

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

	private async get(path: string): Promise<string | null> {
		const url = `${this.baseUrl}${path}`
		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), this.timeoutMs)
			try {
				const res = await this.fetchImpl(url, {
					method: "GET",
					headers: { Accept: "application/json" },
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
