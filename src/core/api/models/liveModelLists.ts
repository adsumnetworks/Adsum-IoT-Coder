import type { ModelInfo } from "@shared/api"
import {
	type FetchedModel,
	type LiveModelProvider,
	RETIRED_MODEL_IDS,
	type ReconcileOptions,
	reconcileModelList,
} from "@shared/liveModels"
import fs from "fs/promises"
import path from "path"

/**
 * Ask a direct provider which models it serves, cache the answer, and reconcile it with the shipped table.
 *
 * Thin on purpose: the decisions live in `reconcileModelList` (shared, pure). This file only fetches,
 * caches and remembers. Everything is best-effort — a failed call (offline, proxy, 401, 5xx, a body that
 * is not a model list) logs one line and the shipped table stands. Nothing here throws to its caller.
 *
 * Endpoints (each checked against the vendor's API reference, all authenticated, none carries prices):
 *   DeepSeek        GET https://api.deepseek.com/models            Authorization: Bearer
 *   Anthropic       GET {anthropicBaseUrl or api.anthropic.com}/v1/models   x-api-key + anthropic-version
 *   GLM Coding Plan GET https://api.z.ai/api/coding/paas/v4/models (or open.bigmodel.cn)   Authorization: Bearer
 */

/** How long a fetched list is trusted before it is asked for again. */
export const LIVE_MODEL_LIST_TTL_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 8_000
export const LIVE_MODEL_LIST_CACHE_FILE = "direct_provider_models.json"

export interface LiveModelRequest {
	provider: LiveModelProvider
	apiKey?: string
	/** Anthropic custom base URL; the GLM line ("china" / "coding-china" selects the mainland host). */
	anthropicBaseUrl?: string
	zaiApiLine?: string
}

export interface HttpResponse {
	status: number
	data: unknown
}
export type HttpGet = (url: string, headers: Record<string, string>, timeoutMs: number) => Promise<HttpResponse>

export interface LiveModelDeps {
	get?: HttpGet
	now?: () => number
	/** Directory the cache file lives in. Default: the extension's cache directory. */
	cacheDir?: () => Promise<string>
	log?: (message: string) => void
}

interface CacheEntry {
	fetchedAt: number
	/** The URL the list came from: a changed base URL is a different provider as far as the list goes. */
	url: string
	models: FetchedModel[]
}
type CacheFile = Partial<Record<LiveModelProvider, CacheEntry>>

/** Per-provider reconcile rules. */
export const RECONCILE_OPTIONS: Readonly<Record<LiveModelProvider, ReconcileOptions>> = {
	deepseek: { retired: RETIRED_MODEL_IDS.deepseek },
	// Anthropic's list carries every generation it still serves; the shipped table is the current one on
	// purpose, so only models at least as new as those are added.
	anthropic: { acceptId: (id) => id.startsWith("claude-"), onlyNewerThanShipped: true },
	"zai-coding-plan": {},
}

export function modelListUrl(request: LiveModelRequest): string {
	switch (request.provider) {
		case "deepseek":
			return "https://api.deepseek.com/models"
		case "anthropic": {
			const base = (request.anthropicBaseUrl || "https://api.anthropic.com").replace(/\/+$/, "")
			return `${base}/v1/models`
		}
		case "zai-coding-plan": {
			const china = request.zaiApiLine === "china" || request.zaiApiLine === "coding-china"
			return china ? "https://open.bigmodel.cn/api/coding/paas/v4/models" : "https://api.z.ai/api/coding/paas/v4/models"
		}
	}
}

function headersFor(request: LiveModelRequest): Record<string, string> {
	const key = request.apiKey?.trim() ?? ""
	if (request.provider === "anthropic") {
		return { "x-api-key": key, "anthropic-version": "2023-06-01" }
	}
	return { Authorization: `Bearer ${key}` }
}

/** `{ data: [{ id, created | created_at }] }` → the ids, or null when the body is not a model list. */
export function parseModelList(body: unknown): FetchedModel[] | null {
	const data = (body as { data?: unknown } | null)?.data
	if (!Array.isArray(data)) {
		return null
	}
	const models: FetchedModel[] = []
	for (const entry of data) {
		const id = (entry as { id?: unknown })?.id
		if (typeof id !== "string" || id.length === 0) {
			continue
		}
		const raw = entry as { created?: unknown; created_at?: unknown }
		let created: number | undefined
		if (typeof raw.created === "number") {
			created = raw.created
		} else if (typeof raw.created_at === "string" && !Number.isNaN(Date.parse(raw.created_at))) {
			created = Math.floor(Date.parse(raw.created_at) / 1000)
		}
		models.push(created === undefined ? { id } : { id, created })
	}
	return models.length > 0 ? models : null
}

const defaultGet: HttpGet = async (url, headers, timeoutMs) => {
	const [{ default: axios }, { getAxiosSettings }] = await Promise.all([import("axios"), import("@/shared/net")])
	const response = await axios.get(url, { headers, timeout: timeoutMs, validateStatus: () => true, ...getAxiosSettings() })
	return { status: response.status, data: response.data }
}

const defaultCacheDir = async () => {
	const { ensureCacheDirectoryExists } = await import("@core/storage/disk")
	return ensureCacheDirectoryExists()
}

/** Ids each provider was last seen serving, for the request path. In memory; filled from cache or fetch. */
const served = new Map<LiveModelProvider, ReadonlySet<string>>()

/**
 * True when the provider was last seen serving this id. Lets a handler send an id the shipped table does
 * not know, without trusting any stray id left in settings by a different provider.
 */
export function isServedLiveModel(provider: LiveModelProvider, id: string | undefined): boolean {
	return !!id && (served.get(provider)?.has(id) ?? false)
}

/** Visible for tests. */
export function resetLiveModelLists(): void {
	served.clear()
}

async function readCache(dir: string): Promise<CacheFile> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, LIVE_MODEL_LIST_CACHE_FILE), "utf8"))
		return parsed && typeof parsed === "object" ? (parsed as CacheFile) : {}
	} catch {
		return {}
	}
}

/** Fill the in-memory served sets from the disk cache, so a request made before any refresh still knows. */
export async function loadCachedLiveModelLists(deps: LiveModelDeps = {}): Promise<void> {
	try {
		const cache = await readCache(await (deps.cacheDir ?? defaultCacheDir)())
		for (const [provider, entry] of Object.entries(cache) as [LiveModelProvider, CacheEntry | undefined][]) {
			if (entry && Array.isArray(entry.models)) {
				served.set(provider, new Set(entry.models.map((m) => m.id)))
			}
		}
	} catch {
		// A cache is an optimisation; the shipped table is the contract.
	}
}

/**
 * The ids the provider serves: from a cache younger than `LIVE_MODEL_LIST_TTL_MS`, else from the provider.
 * Null when there is no key, or the call failed and nothing fresh is cached — the caller shows the shipped table.
 */
export async function getLiveModelIds(request: LiveModelRequest, deps: LiveModelDeps = {}): Promise<FetchedModel[] | null> {
	const now = deps.now ?? Date.now
	const log = deps.log ?? ((m: string) => console.log(m))
	const url = modelListUrl(request)
	let dir: string | undefined
	let cache: CacheFile = {}
	try {
		dir = await (deps.cacheDir ?? defaultCacheDir)()
		cache = await readCache(dir)
	} catch {
		// No cache directory: still fetch, just do not remember.
	}

	const cached = cache[request.provider]
	if (cached && cached.url === url && Array.isArray(cached.models) && now() - cached.fetchedAt < LIVE_MODEL_LIST_TTL_MS) {
		served.set(request.provider, new Set(cached.models.map((m) => m.id)))
		return cached.models
	}

	if (!request.apiKey?.trim()) {
		return null
	}

	let models: FetchedModel[] | null = null
	try {
		const response = await (deps.get ?? defaultGet)(url, headersFor(request), TIMEOUT_MS)
		if (response.status < 200 || response.status >= 300) {
			log(`[models] ${request.provider} model list: HTTP ${response.status}; using the shipped list`)
			return null
		}
		models = parseModelList(response.data)
		if (!models) {
			log(`[models] ${request.provider} model list: not a model list; using the shipped list`)
			return null
		}
	} catch (error) {
		log(
			`[models] ${request.provider} model list: ${error instanceof Error ? error.message : String(error)}; using the shipped list`,
		)
		return null
	}

	served.set(request.provider, new Set(models.map((m) => m.id)))
	if (dir) {
		try {
			const next: CacheFile = { ...cache, [request.provider]: { fetchedAt: now(), url, models } }
			await fs.writeFile(path.join(dir, LIVE_MODEL_LIST_CACHE_FILE), JSON.stringify(next), "utf8")
		} catch {
			// Applied in memory even if it could not be cached.
		}
	}
	return models
}

/** The models to offer for a provider: the shipped table reconciled with what it serves. Never throws. */
export async function refreshLiveModelList(
	request: LiveModelRequest,
	shipped: Readonly<Record<string, ModelInfo>>,
	deps: LiveModelDeps = {},
): Promise<Record<string, ModelInfo>> {
	try {
		return reconcileModelList(shipped, await getLiveModelIds(request, deps), RECONCILE_OPTIONS[request.provider])
	} catch {
		return { ...shipped }
	}
}
