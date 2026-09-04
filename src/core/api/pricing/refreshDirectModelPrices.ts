import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { ClineEnv } from "@/config"
import { ensureCacheDirectoryExists } from "@/core/storage/disk"
import { getAxiosSettings } from "@/shared/net"
import { type PriceOverride, setFetchedPrices } from "./priceOverlay"

/**
 * Keep the direct providers' prices current without shipping a release.
 *
 * DeepSeek, z.ai/GLM, Anthropic and OpenAI publish prices as documentation, not as an endpoint, so
 * unlike the ten providers with `refresh*Models` there is nothing of theirs to poll. Adsum curates
 * the figures instead and serves them at `/v1/pricing`, the same backend and the same trust model
 * as the Knowledge bit registry — so a vendor's price change reaches an installed extension the
 * way an updated CVE table already does.
 *
 * Everything here is best-effort by construction. A price manifest is a convenience over a table
 * that already works: if the network is down, the response is malformed, or the backend has not
 * shipped this route yet, the bundled figures stand and nothing is said. The one thing that must
 * never happen is a failed fetch making costs read as zero.
 */

const CACHE_FILE = "adsum_model_prices.json"
const TIMEOUT_MS = 8_000

interface PriceManifest {
	/** ISO date the figures were last verified against the vendors' own pages. */
	checkedAt?: string
	/** Model id → the fields to override. Absent fields keep the bundled value. */
	models: Record<string, PriceOverride>
}

const isManifest = (v: unknown): v is PriceManifest =>
	typeof v === "object" && v !== null && typeof (v as PriceManifest).models === "object" && (v as PriceManifest).models !== null

/** Load whatever was cached last time, so a cold start with no network is still current-ish. */
export async function loadCachedPrices(): Promise<void> {
	try {
		const file = path.join(await ensureCacheDirectoryExists(), CACHE_FILE)
		if (!(await fileExistsAtPath(file))) {
			return
		}
		const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"))
		if (isManifest(parsed)) {
			setFetchedPrices(parsed.models)
		}
	} catch {
		// A cache is an optimisation. The bundled table is the contract.
	}
}

/**
 * Fetch the manifest and apply it. Safe to call on every activation; never throws.
 * @returns the date the figures were verified, when the backend says so.
 */
export async function refreshDirectModelPrices(): Promise<string | undefined> {
	try {
		const { data } = await axios.get(`${ClineEnv.config().adsumApiBaseUrl}/v1/pricing`, {
			timeout: TIMEOUT_MS,
			...getAxiosSettings(),
		})
		if (!isManifest(data)) {
			return undefined
		}
		setFetchedPrices(data.models)
		try {
			const file = path.join(await ensureCacheDirectoryExists(), CACHE_FILE)
			await fs.writeFile(file, JSON.stringify(data), "utf8")
		} catch {
			// Applied in memory even if it could not be cached — this run is still correct.
		}
		return data.checkedAt
	} catch {
		// Offline, blocked by a proxy, or the route does not exist yet. Bundled prices stand.
		return undefined
	}
}
