import type { ModelInfo } from "@shared/api"

/**
 * Where a model's prices actually come from.
 *
 * [OPERATOR 2026-09-04] "the model prices change over time, the price should be updated
 * dynamically" — and the evidence for that was sitting in the repo: the DeepSeek V4 figures were
 * committed with a comment saying they had been read from the vendor's page, and by the time
 * anyone looked again the flash output rate was 4.7x under the published one. A table compiled
 * into a release cannot track a vendor's pricing, and the test guarding it only proved the table
 * still said what it said the day it was written.
 *
 * Ten providers already refresh their catalogues at runtime (`refreshOpenRouterModels` and
 * friends) because those vendors publish machine-readable model lists. The DIRECT providers —
 * DeepSeek, z.ai/GLM, Anthropic, OpenAI — publish prices only as documentation, so there is
 * nothing to fetch from them. This is the answer for those: three layers, highest wins.
 *
 *   1. **Bundled** — the table in `shared/api.ts`. Always present, works offline, and is the
 *      floor everything else is measured against.
 *   2. **Fetched** — a manifest Adsum serves and curates, refreshed in the background and cached
 *      to disk. Prices change without an extension release, exactly as the CVE tables and Tool
 *      bits already do.
 *   3. **Manual** — the developer's own `adsum.modelPricing` setting. Wins over both, because
 *      someone on an enterprise contract, a regional price list or a negotiated rate knows their
 *      bill better than we do, and should never have to wait for us to publish.
 *
 * A layer only overrides the FIELDS it names. A manifest that carries an output price but no
 * cache prices leaves the cache prices as they were, so a partial or half-written entry degrades
 * to the layer beneath instead of silently zeroing a rate — a zero here reads as "free", which is
 * the most expensive possible thing to get wrong.
 */

/** The subset of ModelInfo a price layer may set. Nothing else is overridable. */
export interface PriceOverride {
	inputPrice?: number
	outputPrice?: number
	cacheReadsPrice?: number
	cacheWritesPrice?: number
}

export interface PriceLayers {
	/** Curated by Adsum, fetched at runtime. Keyed by model id. */
	fetched?: Readonly<Record<string, PriceOverride>>
	/** The developer's own, from settings. Keyed by model id. Highest precedence. */
	manual?: Readonly<Record<string, PriceOverride>>
}

const PRICE_FIELDS = ["inputPrice", "outputPrice", "cacheReadsPrice", "cacheWritesPrice"] as const

/** A price is usable if it is a finite, non-negative number. Anything else is ignored, loudly in
 *  tests and silently at runtime, because a malformed price must never become a real one. */
const usable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0

let layers: PriceLayers = {}

/** Replace the fetched layer (called after a refresh). */
export function setFetchedPrices(fetched: Readonly<Record<string, PriceOverride>> | undefined): void {
	layers = { ...layers, fetched }
}

/** Replace the manual layer (called when the setting changes). */
export function setManualPrices(manual: Readonly<Record<string, PriceOverride>> | undefined): void {
	layers = { ...layers, manual }
}

/** Visible for tests and for a diagnostic command; never mutate the result. */
export function getPriceLayers(): PriceLayers {
	return layers
}

export function resetPriceLayers(): void {
	layers = {}
}

/**
 * The prices to bill with, for one model. Returns the same object when nothing overrides it, so
 * this is safe to call on every request.
 */
export function applyPriceOverlay<T extends ModelInfo>(modelId: string | undefined, info: T): T {
	if (!modelId) {
		return info
	}
	const patch: PriceOverride = {}
	// Fetched first, then manual on top: the developer's own figure is the last word.
	for (const layer of [layers.fetched?.[modelId], layers.manual?.[modelId]]) {
		if (!layer) {
			continue
		}
		for (const field of PRICE_FIELDS) {
			const value = layer[field]
			if (usable(value)) {
				patch[field] = value
			}
		}
	}
	return Object.keys(patch).length === 0 ? info : { ...info, ...patch }
}
