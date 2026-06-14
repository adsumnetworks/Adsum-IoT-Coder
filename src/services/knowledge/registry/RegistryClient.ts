import { ClineEnv } from "@/config"

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
	) {}

	/** The downloadable catalog, or null if unreachable/malformed. */
	async fetchManifest(): Promise<DownloadedManifest | null> {
		const text = await this.get("/v1/kbits/manifest")
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
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.timeoutMs)
		try {
			const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			})
			return res.ok ? await res.text() : null
		} catch {
			return null
		} finally {
			clearTimeout(timer)
		}
	}
}
