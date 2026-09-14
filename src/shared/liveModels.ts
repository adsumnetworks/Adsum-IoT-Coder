import {
	type ApiProvider,
	anthropicModels,
	anthropicPricesCheckedAt,
	deepSeekModels,
	deepSeekPricesCheckedAt,
	type ModelInfo,
	zaiCodingPlanModels,
	zaiCodingPlanPricesCheckedAt,
} from "./api"

/**
 * Which models a direct provider serves TODAY, and how old the prices we show for them are.
 *
 * [OPERATOR 2026-09-14] "the extension must retrieve the latest models dynamically, and the prices it
 * shows were stale." What bit: DeepSeek served `deepseek-v4-flash` as `deepseek-flash` from 10 September,
 * and the shipped list kept offering the old name. A list compiled into a release cannot follow a vendor's
 * renames, so the vendors that publish a model list are asked for it, and the shipped table is the floor.
 *
 * Everything in this file is pure (no network, no disk, no clock) so the host and the settings panel apply
 * the SAME rules, and so the rules are tested without either.
 */

/** Direct providers in the provider dropdown whose API publishes a list of the models it serves. */
export const LIVE_MODEL_PROVIDERS = ["deepseek", "anthropic", "zai-coding-plan"] as const
export type LiveModelProvider = (typeof LIVE_MODEL_PROVIDERS)[number]

export const isLiveModelProvider = (provider: string | undefined): provider is LiveModelProvider =>
	(LIVE_MODEL_PROVIDERS as readonly string[]).includes(provider ?? "")

/** The shipped table each live list is reconciled against. */
export const SHIPPED_MODELS: Readonly<Record<LiveModelProvider, Readonly<Record<string, ModelInfo>>>> = {
	deepseek: deepSeekModels,
	anthropic: anthropicModels,
	"zai-coding-plan": zaiCodingPlanModels,
}

/**
 * The date each shipped price table was last checked against the vendor's own page. Only providers whose
 * prices come from our table are here: OpenRouter prices arrive live with its model list.
 */
export const PRICES_CHECKED_AT: Readonly<Partial<Record<ApiProvider, string>>> = {
	deepseek: deepSeekPricesCheckedAt,
	anthropic: anthropicPricesCheckedAt,
	"zai-coding-plan": zaiCodingPlanPricesCheckedAt,
}

/**
 * Ids the provider has retired, dated from its own pricing page. Never offered — with or without a live list,
 * so a developer who has not entered a key yet is not offered them either. A configuration that already
 * names one still resolves in the provider's handler (the shipped table keeps them for that) and the model
 * dropdown labels it as no longer offered.
 *   deepseek-chat, deepseek-reasoner — no longer on api-docs.deepseek.com/quick_start/pricing, checked 2026-08-13
 *   deepseek-v4-flash               — "still accepted, but … retired", served as deepseek-flash, checked 2026-09-14
 */
export const RETIRED_MODEL_IDS: Readonly<Record<LiveModelProvider, readonly string[]>> = {
	deepseek: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash"],
	anthropic: [],
	"zai-coding-plan": [],
}

/** A provider's table without the ids it has retired. */
export function withoutRetired(provider: string, models: Readonly<Record<string, ModelInfo>>): Record<string, ModelInfo> {
	const retired = new Set(isLiveModelProvider(provider) ? RETIRED_MODEL_IDS[provider] : [])
	return Object.fromEntries(Object.entries(models).filter(([id]) => !retired.has(id)))
}

/** One entry of a provider's model list. `created` is seconds since the epoch, when the provider says. */
export interface FetchedModel {
	id: string
	created?: number
}

/**
 * Info for a model the provider serves that our table does not know. Deliberately conservative: no images,
 * no prompt cache, no reasoning controls, a modest window — and NO prices, because a guessed price is a
 * wrong price, and a zero reads as free. `hasUnknownPrices` recognises it.
 */
export const UNKNOWN_MODEL_INFO: ModelInfo = {
	maxTokens: 8_192,
	contextWindow: 128_000,
	supportsImages: false,
	supportsPromptCache: false,
}

/** True when the info carries no input or output price at all, i.e. we do not know what it costs. */
export function hasUnknownPrices(info: ModelInfo | undefined): boolean {
	return !!info && info.inputPrice === undefined && info.outputPrice === undefined && !info.tiers?.length
}

export interface ReconcileOptions {
	/** Only these fetched ids are ever offered (e.g. chat models, not embeddings). Default: all. */
	acceptId?: (id: string) => boolean
	/**
	 * Offer a newly served id only when it is at least as new as the oldest shipped model the provider
	 * still serves. For a provider whose list also carries every older generation (Anthropic), so a
	 * curated "current generation only" table is not refilled with models we removed on purpose.
	 */
	onlyNewerThanShipped?: boolean
	/** Info given to a served id the table does not know. */
	unknownInfo?: ModelInfo
	/** Ids never offered, whatever the provider's list says (see RETIRED_MODEL_IDS). */
	retired?: readonly string[]
}

/** `claude-haiku-4-5-20251001` is a dated snapshot of `claude-haiku-4-5`: the alias stays served. */
const DATED_SNAPSHOT = /^(.*)-\d{8}$/

/**
 * The models to offer: the shipped table, corrected by what the provider says it serves.
 *
 * - `fetched` null, undefined or empty → the shipped table, unchanged. An empty list from a provider that
 *   serves models is a failed call, not a retirement of everything.
 * - A shipped id the provider no longer serves is dropped (directly or through a dated snapshot of it).
 * - A served id the table does not know is added with `unknownInfo`.
 * - Shipped ids keep their shipped info and order; new ids follow, sorted.
 */
export function reconcileModelList(
	shipped: Readonly<Record<string, ModelInfo>>,
	fetched: readonly FetchedModel[] | null | undefined,
	options: ReconcileOptions = {},
): Record<string, ModelInfo> {
	const retired = new Set(options.retired ?? [])
	const accepted = (fetched ?? []).filter((m) => m && typeof m.id === "string" && m.id.length > 0 && !retired.has(m.id))
	const offered = options.acceptId ? accepted.filter((m) => options.acceptId!(m.id)) : accepted
	if (offered.length === 0) {
		return Object.fromEntries(Object.entries(shipped).filter(([id]) => !retired.has(id)))
	}

	const servedIds = new Set(offered.map((m) => m.id))
	const snapshotOf = (id: string) => DATED_SNAPSHOT.exec(id)?.[1]
	const servedAliases = new Set(offered.map((m) => snapshotOf(m.id)).filter((a): a is string => !!a))

	const result: Record<string, ModelInfo> = {}
	for (const [id, info] of Object.entries(shipped)) {
		if (servedIds.has(id) || servedAliases.has(id)) {
			result[id] = info
		}
	}

	let oldestShipped: number | undefined
	if (options.onlyNewerThanShipped) {
		for (const m of offered) {
			const coversShipped = m.id in result || (snapshotOf(m.id) ?? "") in result
			if (coversShipped && typeof m.created === "number") {
				oldestShipped = oldestShipped === undefined ? m.created : Math.min(oldestShipped, m.created)
			}
		}
	}

	const added = offered
		.filter((m) => !(m.id in result))
		// A snapshot of an alias we already offer is the same model under a second name.
		.filter((m) => !((snapshotOf(m.id) ?? "") in result))
		.filter((m) => {
			if (!options.onlyNewerThanShipped) {
				return true
			}
			// Without a date to compare, an older generation cannot be told from a newer one: leave it out.
			return oldestShipped !== undefined && typeof m.created === "number" && m.created >= oldestShipped
		})
		.map((m) => m.id)
		.sort()
	for (const id of added) {
		result[id] = { ...(options.unknownInfo ?? UNKNOWN_MODEL_INFO) }
	}
	return result
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * "Prices checked 4 Sep 2026" for an ISO date (YYYY-MM-DD). Undefined for anything else, so a malformed
 * date shows nothing rather than a wrong one. Formatted by hand, not by locale, so it reads the same on
 * every machine and in every test.
 */
export function pricesCheckedLabel(date: string | undefined): string | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "")
	if (!match) {
		return undefined
	}
	const [, year, month, day] = match
	const m = Number(month)
	const d = Number(day)
	if (m < 1 || m > 12 || d < 1 || d > 31) {
		return undefined
	}
	return `Prices checked ${d} ${MONTHS[m - 1]} ${year}`
}
