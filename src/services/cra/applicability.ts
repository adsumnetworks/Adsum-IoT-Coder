/**
 * Applicability engine (CVE scan loop — design/15 §6). The embedded-aware moat: given a CVE match + the
 * build's own evidence (merged .config, ELF symbol dump), produce a HEDGED applicability note.
 *
 * Honest as an EXCLUSION, never a confident confirmation (red-team hard constraint):
 *  - config-gate: the gating Kconfig is `=n` ⇒ the affected code is not compiled (strong exclusion).
 *  - linked-symbol: the affected function's symbol is ABSENT from the final image ⇒ gc-sections stripped it
 *    ⇒ very likely not reachable (strong NEGATIVE). PRESENT is a weak signal ("may be reachable, verify"),
 *    pending the §12 spike confirming gc-sections actually strips. We NEVER emit "not affected"/"not reachable"
 *    as a verdict — only "likely … verify". Deterministic + fixture-testable; no network, no model content.
 */

export type ApplicabilitySignal = "config-gated-out" | "not-linked" | "linked" | "config-present" | "unknown"

export interface ApplicabilityVerdict {
	signal: ApplicabilitySignal
	/** Hedged, evidence-mode line — always ends in "verify"; never a conformity/verdict word. */
	note: string
}

export interface BuildEvidence {
	/** Merged Kconfig (`build/zephyr/.config` or `sdkconfig`) content, if a build exists. */
	dotConfig?: string
	/** `nm` / `.map` symbol dump of the final ELF, if a build exists. */
	symbols?: string
}

/**
 * Curated hint for a CVE/component: which Kconfig gates the vulnerable code, and which function symbol is in
 * the ELF iff that code is linked. Seed map, grown per advisory — absence of a hint → "unknown" (honest).
 */
export interface ApplicabilityHint {
	gateSymbol?: string
	codeSymbol?: string
}

/** true (=y) · false (=n / "is not set") · undefined (not mentioned). */
function kconfigState(dotConfig: string, sym: string): boolean | undefined {
	const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	if (new RegExp(`^\\s*${esc}\\s*=\\s*y\\s*$`, "im").test(dotConfig)) {
		return true
	}
	if (new RegExp(`^\\s*(#\\s*${esc}\\s+is not set|${esc}\\s*=\\s*n)\\s*$`, "im").test(dotConfig)) {
		return false
	}
	return undefined
}

function symbolPresent(symbols: string, sym: string): boolean {
	const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return new RegExp(`\\b${esc}\\b`).test(symbols)
}

/**
 * Assess applicability for one match. Returns the strongest available EXCLUSION signal, else "unknown".
 * design/25 T4: the `note` strings below are the HOST's home-of-record for the applicability hedges — the model
 * presents them verbatim (anti-fabrication, D11-R: a drifting model must not soften "verify" into "safe"). So the
 * bit must NOT restate this wording — it says "present the host's note verbatim." Edit the hedges HERE only.
 */
export function assessApplicability(hint: ApplicabilityHint | undefined, evidence: BuildEvidence): ApplicabilityVerdict {
	// Strongest exclusion: the gating Kconfig is disabled → the affected code is not compiled.
	if (hint?.gateSymbol && evidence.dotConfig && kconfigState(evidence.dotConfig, hint.gateSymbol) === false) {
		return {
			signal: "config-gated-out",
			note: `${hint.gateSymbol} is disabled in your build, so the affected code is not compiled — likely not applicable; verify.`,
		}
	}
	// Linked-symbol: absent ⇒ stripped ⇒ very likely not in the image (strong negative); present ⇒ weak.
	if (hint?.codeSymbol && evidence.symbols) {
		if (!symbolPresent(evidence.symbols, hint.codeSymbol)) {
			return {
				signal: "not-linked",
				note: `${hint.codeSymbol} is not in your built image — very likely not reachable; verify.`,
			}
		}
		return {
			signal: "linked",
			note: `${hint.codeSymbol} is linked into your build — it may be reachable; verify against the advisory.`,
		}
	}
	// Weak POSITIVE (design/28): the gating Kconfig is ENABLED → the affected code is compiled, so the CVE may be
	// reachable. Stays asymmetric — a hedged "may be reachable; verify", NEVER a confident "affected". Lets a
	// config-only hint (no shippable symbol) promote a finding from "unknown" to an actionable "verify this one".
	if (hint?.gateSymbol && evidence.dotConfig && kconfigState(evidence.dotConfig, hint.gateSymbol) === true) {
		return {
			signal: "config-present",
			note: `${hint.gateSymbol} is enabled in your build, so the affected code is compiled — may be reachable; verify.`,
		}
	}
	return {
		signal: "unknown",
		note: "No applicability signal for your build — open the advisory and verify whether it applies.",
	}
}
