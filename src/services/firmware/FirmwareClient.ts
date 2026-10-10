import { ClineEnv } from "@/config"
import { getSessionToken } from "@/services/adsum/sessionToken"

/**
 * [0.5 the firmware lane] The registry's firmware routes, as the extension calls them. Images and source
 * are not tool bits: a `type: firmware` version is listed by the manifest, authorised FRESH on the server at
 * the moment of Download (a 15-minute token naming the exact files), and fetched file by file with that
 * token. A valid session bearer alone never opens the bytes.
 */
export interface FirmwareArtifact {
	path: string
	sha256: string
	size: number
	group: string | null
}

export interface FirmwareLicence {
	id: string
	text: string | null
	termMonths: number
}

export interface FirmwareEntry {
	id: string
	version: string
	family: string | null
	variant: string | null
	rung: string | null
	group: string | null
	title: string
	summary: string | null
	min_ext: string | null
	security: boolean
	released_at: string | null
	licence: FirmwareLicence
	signature: string | null
	signed_by: string | null
	entitled: boolean
	artifacts: FirmwareArtifact[]
}

export interface FirmwareManifest {
	firmware: FirmwareEntry[]
	account: { email: string; groups: string[] } | null
}

export interface FirmwareAuthorisation {
	token: string
	expires_in: number
	expires_at: string
	licensee: string
	firmware: FirmwareEntry
}

export class FirmwareLockedError extends Error {
	constructor(
		readonly group: string | null,
		message = "entitlement_required",
	) {
		super(message)
		this.name = "FirmwareLockedError"
	}
}

export class FirmwareClient {
	constructor(
		private readonly baseUrl: string = ClineEnv.config().adsumApiBaseUrl,
		private readonly fetchImpl: typeof fetch = fetch,
		private readonly timeoutMs = 20_000,
	) {}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		const h: Record<string, string> = { Accept: "application/json", ...extra }
		const session = getSessionToken()
		if (session) {
			h.Authorization = `Bearer ${session}`
		}
		return h
	}

	private async call(path: string, init: RequestInit = {}): Promise<Response> {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.timeoutMs)
		try {
			return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
		} finally {
			clearTimeout(timer)
		}
	}

	/** Every published firmware version, entitled or not, so the ladder can draw its states. */
	async manifest(id?: string): Promise<FirmwareManifest> {
		const res = await this.call(`/v1/firmware/manifest${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
			headers: this.headers(),
		})
		if (!res.ok) {
			throw new Error(`firmware manifest: ${res.status}`)
		}
		return (await res.json()) as FirmwareManifest
	}

	/** The fresh server check. 402 is a locked rung, said as such; 401 is "sign in". */
	async authorise(id: string, version: string): Promise<FirmwareAuthorisation> {
		const res = await this.call("/v1/firmware/authorise", {
			method: "POST",
			headers: this.headers({ "Content-Type": "application/json" }),
			body: JSON.stringify({ id, version }),
		})
		if (res.status === 402) {
			const body = (await res.json().catch(() => ({}))) as { group?: string | null }
			throw new FirmwareLockedError(body.group ?? null)
		}
		if (res.status === 401) {
			throw new Error("sign in to download firmware")
		}
		if (!res.ok) {
			throw new Error(`firmware authorise: ${res.status}`)
		}
		return (await res.json()) as FirmwareAuthorisation
	}

	/**
	 * One file, under the authorisation that covers it. The caller verifies the hash before keeping it. The
	 * token travels in a header, never in the URL: a URL is logged, a header is not.
	 */
	async artifact(sha256: string, token: string, memberPath: string): Promise<Buffer> {
		const res = await this.call(`/v1/firmware/artifact/${sha256}`, {
			headers: { Accept: "application/octet-stream", "X-Adsum-Firmware-Token": token },
		})
		if (res.status === 402 || res.status === 403) {
			throw new FirmwareLockedError(null, "authorisation_required")
		}
		if (!res.ok) {
			throw new Error(`firmware artifact ${memberPath}: ${res.status}`)
		}
		return Buffer.from(await res.arrayBuffer())
	}
}
