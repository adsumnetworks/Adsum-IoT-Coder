/**
 * Curated CVE → applicability-hint map (CVE scan loop — design/15 §6). For a known advisory it names the Kconfig
 * that gates the vulnerable code and/or the function symbol present iff that code is linked, so the applicability
 * engine can produce a HEDGED exclusion ("disabled in your build … verify").
 *
 * ⚠️ RISK: a WRONG mapping is the most dangerous error in the whole loop — it yields a false EXCLUSION that hides
 * a real, reachable vulnerability. Mitigation: this seed is **empty by design**. Add an entry ONLY after
 * verifying, for that exact CVE, (a) which Kconfig actually gates the affected code and (b) which symbol is in
 * the ELF iff it's linked — ideally confirmed during the design/16 spike on a real build. Until an entry exists,
 * the resolver returns `undefined` → the engine reports "unknown" (honest), never a fabricated exclusion.
 *
 * Each entry MUST carry a `verifiedNote` (how it was confirmed) so the provenance of every exclusion is auditable.
 */
import type { ApplicabilityHint } from "./applicability"
import type { HintResolver } from "./scanLoop"

export interface VerifiedAdvisoryHint extends ApplicabilityHint {
	/** How this mapping was confirmed (build + version) — required so no unverified exclusion can sneak in. */
	verifiedNote: string
}

/**
 * Seed map: CVE/OSV id → verified hint. EMPTY until entries are confirmed on a real build (design/16). Grown by
 * the §10 SBOM-feedback loop (which gaps recur → which to verify+map next). Do NOT add speculative entries.
 */
export const ADVISORY_HINTS: Record<string, VerifiedAdvisoryHint> = {}

/** Resolver wired into `runCveScan`. Returns a hint only for a verified CVE; unknown CVEs → undefined → "unknown". */
export const resolveAdvisoryHint: HintResolver = (vulnId) => {
	const hint = ADVISORY_HINTS[vulnId]
	if (!hint) {
		return undefined
	}
	// Strip the provenance field — the engine only consumes gateSymbol/codeSymbol.
	return { gateSymbol: hint.gateSymbol, codeSymbol: hint.codeSymbol }
}
