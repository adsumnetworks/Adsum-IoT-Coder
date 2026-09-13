/**
 * What to suggest, and why — one ranking, shared by the entry surface and the in-session
 * next-step chooser.
 *
 * There were four separate decisions in this folder reading the same signals: the platform
 * resolver, the CRA card's evidence rule, the tenure split, and the demo-hero rule. Four homes for
 * one question is how they drift apart, and the CRA rule was the best of them — it fires only on
 * detected evidence and hands the interface a *reason* rather than a verdict. This generalises
 * that shape instead of adding a fifth.
 *
 * Four rules it keeps:
 *
 *  1. **A connected board outranks an installed toolchain.** Hardware on the desk is intent; a
 *     toolchain is only capability.
 *  2. **Rank, never hide.** The drawer always holds the full catalogue. A wrong reading should
 *     cost a scroll, not a feature.
 *  3. **Never silently one platform.** With no signal, or contradictory ones, alternate rather
 *     than letting list order decide — a developer must never be quietly told this is an nRF tool.
 *  4. **Every suggestion says why**, in the CRA card's evidence voice: what was detected, never a
 *     verdict about it.
 */

import type { WorkspacePlatform } from "./welcomeIntents"

/** Everything the extension can actually see, in one place. */
export interface Signals {
	/** Nordic boards the detector currently reports. */
	nrfBoards: string[]
	/** ESP devices the detector currently reports. */
	espDevices: string[]
	/** How the open workspace classifies. */
	classification: WorkspacePlatform
	/** Installed toolchains — capability, the weakest signal here. */
	toolchains: { nrf: boolean; esp: boolean }
	/** Grounded feature probes from the open project. */
	features: { hasBle: boolean; hasWifi: boolean; hasCompliance: boolean }
	/** True when a folder is open at all. */
	hasWorkspace: boolean
	/** A product this workspace is recognisably about, e.g. "lew840x". */
	product?: string
}

/** A thing the developer could start. `platform` is what it needs, not what it is about. */
export interface Suggestable {
	id: string
	platform: WorkspacePlatform | "product"
	/** A product id this run belongs to; ranked top when the workspace is that product. */
	need?: string
	/** Shown instead of a platform reason when nothing is detected — for runs whose requirement is
	 *  hardware we cannot see, like a sealed product needing its own programming kit. */
	whyNeutral?: string
	/**
	 * What THIS run needs beyond the board already on the desk.
	 *
	 * Every product row used to say the same sentence — "this build also needs the rest of the kit" —
	 * five times down one drawer, and the one thing that would have helped, which part is missing for
	 * this run, was the part it did not say. A row that cannot name its own gap says nothing extra.
	 */
	needsAlso?: string
	/** How to NAME the product to a person. Without it a reason line would print the internal id
	 *  ("this looks like a lew840x project"), and an id is not a product name. */
	productLabel?: string
	/** Held behind an entitlement the account does not have. Ranking treats it as a tiebreak only:
	 *  a locked card never LOSES the evidence that ranked it, it just yields to an equal card the
	 *  developer can start right now. [SWEEP 2026-09-09] Measured before this: a signed-out
	 *  developer with an nRF9160 DK saw the locked BLG card above "Build, flash & debug". */
	locked?: boolean
	/** Board names that make this run a BOARD MATCH — for runs that need one particular family, not
	 *  "any nRF". A modem bring-up ranked as a match because an nRF52840 DK is on the desk would be
	 *  the ranking lying; this lets it say "nRF9151 DK connected" and mean it. */
	boardMatch?: RegExp
}

export interface Ranked<T> {
	item: T
	score: number
	/** Evidence, in the developer's language. Empty only if nothing at all could be said. */
	why: string
	/** Does `why` cite something actually DETECTED — a board, a product, an installed toolchain?
	 *
	 * [SCREENSHOT 2026-09-04] The fallback reasons ("works on nRF and on ESP32", "no board
	 * detected — showing a mix", "no matching board connected") describe the *absence* of a
	 * signal, so every row that reaches one prints the identical sentence. Six consecutive rows
	 * saying "works on nRF and on ESP32" separate nothing and, in cyan, were the loudest text on
	 * the surface. A surface can now suppress them without matching on their wording, which would
	 * break the moment someone rephrases a string. */
	grounded: boolean
}

const SCORE = {
	product: 100,
	boardMatch: 80,
	craGrounded: 70,
	productPartial: 65,
	// BELOW `either`, deliberately. This is the score for a run we can state the requirements of
	// but cannot confirm you meet — a sealed product needing its own kit and a probe. It used to
	// outrank a run that works with whatever you already have, so an empty folder with NO boards
	// detected led with "buy a gateway, a bridge board and a Nordic DK". Stating a requirement is
	// not evidence that it is met; a run you can start now should come first.
	neutralRequirement: 25,
	either: 30,
	noSignal: 20,
	noMatch: 10,
} as const

/**
 * Order a catalogue by what is actually detected, and say why for each entry.
 *
 * Never filters. The caller decides how many to show; everything else stays reachable.
 */
export function rank<T extends Suggestable>(items: T[], s: Signals): Ranked<T>[] {
	const nrf = s.nrfBoards[0]
	const esp = s.espDevices[0]
	const hasNrf = s.nrfBoards.length > 0
	const hasEsp = s.espDevices.length > 0
	const nothingDetected = !hasNrf && !hasEsp && !s.hasWorkspace

	const scored: Ranked<T>[] = items.map((item) => {
		if (item.boardMatch) {
			const hit = [...s.nrfBoards, ...s.espDevices].find((b) => item.boardMatch!.test(b))
			if (hit) {
				return { item, score: SCORE.boardMatch, why: `${hit} connected`, grounded: true }
			}
		}
		if (item.need && s.product === item.need) {
			return {
				item,
				score: SCORE.product,
				why: `this looks like a ${item.productLabel ?? item.need} project`,
				grounded: true,
			}
		}
		if (item.platform === "nrf" && hasNrf) {
			return { item, score: SCORE.boardMatch, why: `${nrf} connected`, grounded: true }
		}
		if (item.platform === "esp" && hasEsp) {
			return { item, score: SCORE.boardMatch, why: `${esp} connected`, grounded: true }
		}
		// The CRA rule, kept verbatim in spirit: a connectivity stack present and no SBOM yet.
		if (item.id === "craCheck" && s.hasWorkspace && (s.features.hasBle || s.features.hasWifi) && !s.features.hasCompliance) {
			const what = s.features.hasBle && s.features.hasWifi ? "BLE and Wi-Fi" : s.features.hasWifi ? "Wi-Fi" : "BLE"
			return { item, score: SCORE.craGrounded, why: `${what} in this project and no SBOM yet`, grounded: true }
		}
		if (item.platform === "product" && (hasNrf || hasEsp)) {
			return {
				item,
				score: SCORE.productPartial,
				why: item.needsAlso
					? `${nrf ?? esp} connected · this one also needs ${item.needsAlso}`
					: `${nrf ?? esp} connected`,
				grounded: true,
			}
		}
		if (item.whyNeutral) {
			// A requirements list, not a detection. True and useful on the card that leads, noise on a row.
			return { item, score: SCORE.neutralRequirement, why: item.whyNeutral, grounded: false }
		}
		if (item.platform === s.classification && s.classification !== "none") {
			return { item, score: SCORE.boardMatch - 20, why: "matches the project you have open", grounded: true }
		}
		if (item.platform === "both") {
			// A run that works on either platform is, in practice, about the board that is plugged
			// in. Saying "works on either platform" while an nRF52840 DK sits on the desk is true
			// and useless — the developer wants to know the suggestion noticed their hardware.
			// Only when exactly one platform is present: with both, "either" is the honest answer.
			if (hasNrf && !hasEsp) {
				return { item, score: SCORE.boardMatch - 5, why: `${nrf} connected`, grounded: true }
			}
			if (hasEsp && !hasNrf) {
				return { item, score: SCORE.boardMatch - 5, why: `${esp} connected`, grounded: true }
			}
			return { item, score: SCORE.either, why: "works on nRF and on ESP32", grounded: false }
		}
		if ((item.platform === "nrf" && s.toolchains.nrf) || (item.platform === "esp" && s.toolchains.esp)) {
			return {
				item,
				score: SCORE.noSignal + 5,
				why: `its toolchain is installed (${item.platform === "nrf" ? "nRF Connect SDK" : "ESP-IDF"})`,
				grounded: true,
			}
		}
		if (nothingDetected) {
			return { item, score: SCORE.noSignal, why: "no board detected — showing a mix", grounded: false }
		}
		return { item, score: SCORE.noMatch, why: "no matching board connected", grounded: false }
	})

	scored.sort((a, b) => b.score - a.score)

	if (!nothingDetected) {
		return scored
	}
	// Nothing to go on. Alternate the two platforms so neither wins by where it sits in the array.
	const products = scored.filter((x) => x.item.platform === "product")
	const nrfs = scored.filter((x) => x.item.platform === "nrf")
	const esps = scored.filter((x) => x.item.platform === "esp")
	const rest = scored.filter((x) => !["product", "nrf", "esp"].includes(x.item.platform))
	const mixed: Ranked<T>[] = []
	for (let i = 0; i < Math.max(nrfs.length, esps.length); i++) {
		if (nrfs[i]) mixed.push(nrfs[i])
		if (esps[i]) mixed.push(esps[i])
	}
	for (const r of scored) {
		if (r.item.locked) {
			r.score -= 1
		}
	}
	return [...products, ...mixed, ...rest]
}
