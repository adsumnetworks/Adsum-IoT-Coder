/**
 * Routing: which seller serves the model, and on what terms.
 *
 * A developer with their own key is buying from a market, not from one vendor, and tonight taught us
 * three things the hard way. A sort field silently overrides the tail of an order list. A price
 * ceiling can exclude the very fallback you named, without saying so. And with fallbacks left on,
 * the router hands traffic to whoever is cheapest at that second — reduced-precision copies included.
 *
 * The settings are written in the developer's words; the API's field names live here and nowhere a
 * developer can see them. Nothing set means nothing sent: an existing configuration behaves exactly
 * as it did before this file existed.
 */

export interface RoutingSettings {
	/** Sellers to use, in order. */
	order?: string[]
	/** "Only these sellers" — no substitutions when true. */
	onlyThese?: boolean
	/** Highest price accepted, in dollars per million tokens. */
	maxInputPrice?: number
	maxOutputPrice?: number
	/** "Only sellers that support tool calls". On unless the developer turns it off. */
	requireToolCalls?: boolean
	/** The older single sorting choice. Ignored while an order is set — the two contradict. */
	sort?: string
	/** Advanced: extra request body, merged last. */
	extraBody?: string
}

export interface RoutingProviderBlock {
	order?: string[]
	allow_fallbacks?: boolean
	max_price?: { prompt?: number; completion?: number }
	require_parameters?: boolean
	sort?: string
}

/** The `provider` block, or undefined when the developer has asked for nothing. */
export function buildProviderBlock(settings: RoutingSettings): RoutingProviderBlock | undefined {
	const block: RoutingProviderBlock = {}
	const order = (settings.order ?? []).map((s) => s.trim()).filter(Boolean)
	if (order.length > 0) {
		block.order = order
	}
	// Only meaningful as FALSE: true is the router's own default, and sending it would make a
	// default look like a decision.
	if (settings.onlyThese) {
		block.allow_fallbacks = false
	}
	const price: { prompt?: number; completion?: number } = {}
	if (typeof settings.maxInputPrice === "number" && settings.maxInputPrice >= 0) {
		price.prompt = settings.maxInputPrice
	}
	if (typeof settings.maxOutputPrice === "number" && settings.maxOutputPrice >= 0) {
		price.completion = settings.maxOutputPrice
	}
	if (price.prompt !== undefined || price.completion !== undefined) {
		block.max_price = price
	}
	if (settings.requireToolCalls !== false) {
		block.require_parameters = true
	}
	/*
	 * The sort is dropped whenever an order is set, and this is the bug that cost us an evening: the
	 * router applies the sort to everything after the ordered head, so a list that reads like a
	 * preference silently becomes a preference plus a lottery.
	 */
	if (settings.sort && !block.order) {
		block.sort = settings.sort
	}
	return Object.keys(block).length > 0 ? block : undefined
}

/** True when the settings make the sort choice meaningless — the UI greys it out and says why. */
export function sortIsOverridden(settings: RoutingSettings): boolean {
	return (settings.order ?? []).some((s) => s.trim().length > 0)
}

/**
 * A named seller the ceiling would exclude, if any.
 *
 * The warning exists because a ceiling below the price of the fallback you named does not fail: the
 * router simply never chooses it, and the developer discovers that when their traffic goes somewhere
 * else. Prices are dollars per million tokens, the same units the settings ask for.
 */
export function sellersAboveCeiling(
	settings: RoutingSettings,
	livePrices: Record<string, { input?: number; output?: number }>,
): string[] {
	const out: string[] = []
	for (const seller of settings.order ?? []) {
		const price = livePrices[seller.trim()]
		if (!price) {
			continue
		}
		const overInput = typeof settings.maxInputPrice === "number" && (price.input ?? 0) > settings.maxInputPrice
		const overOutput = typeof settings.maxOutputPrice === "number" && (price.output ?? 0) > settings.maxOutputPrice
		if (overInput || overOutput) {
			out.push(seller.trim())
		}
	}
	return out
}

/** Keys the advanced field may never set, whatever it contains. */
const PROTECTED_KEYS = new Set(["model", "messages", "stream", "stream_options"])

/**
 * Our fields first, the developer's advanced JSON last — except for the keys that decide WHAT is
 * being asked and of whom. Those always win, because an advanced field that can retarget the request
 * is a footgun rather than an escape hatch.
 */
export function mergeAdvancedBody<T extends Record<string, unknown>>(base: T, extraBody?: string): T {
	if (!extraBody || !extraBody.trim()) {
		return base
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(extraBody)
	} catch {
		// Unparseable JSON is ignored rather than thrown: a half-typed field must not break a run.
		return base
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return base
	}
	const merged: Record<string, unknown> = { ...base }
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (PROTECTED_KEYS.has(key)) {
			continue
		}
		merged[key] = value
	}
	return merged as T
}
