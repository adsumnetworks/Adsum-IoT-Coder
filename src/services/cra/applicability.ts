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

export type ApplicabilitySignal =
	| "fix-present"
	| "version-fixed"
	| "config-gated-out"
	| "not-linked"
	| "linked"
	| "config-present"
	| "unknown"

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
	/** P2 (design/30): the upstream fix commit SHA. If it's present in the dev's source tree (a forked SDK can
	 *  backport a fix WITHOUT bumping the version), the CVE is already patched → "fix-present". The git check is
	 *  impure/async, so its boolean RESULT is passed into assessApplicability (not run here). */
	fixCommitSha?: string
	/** design/32: the first component version that CONTAINS the fix (e.g. Zephyr "4.2.0"), curated from the
	 *  advisory's "Patched versions" / "Affected <= X". When the build's component version is at/after this, the
	 *  CVE is fixed regardless of a SHA — cleaner than fix-commit for forks (no cherry-pick ambiguity). Used to
	 *  resolve unversioned EUVD discover-by-product leads (EUVD carries no version ranges). */
	fixedInVersion?: string
}

/** Parse a dotted version ("4.2.99", "4.2", "v6.0.1") to [major, minor, patch]; null if not a recognizable semver. */
function parseSemver(v: string | undefined): [number, number, number] | null {
	if (!v) {
		return null
	}
	const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v)
	return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

/** True iff `have` >= `want` by numeric major.minor.patch. False (conservative) if either is unparseable. */
export function semverGte(have: string | undefined, want: string | undefined): boolean {
	const a = parseSemver(have)
	const b = parseSemver(want)
	if (!a || !b) {
		return false
	}
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) {
			return a[i] > b[i]
		}
	}
	return true
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
export function assessApplicability(
	hint: ApplicabilityHint | undefined,
	evidence: BuildEvidence,
	/** P2: did the git check find this hint's fixCommitSha in the dev's source tree? true = patched (definitive
	 *  exclusion); false = not patched (says nothing about reachability — fall through); undefined = not checked. */
	fixPresent?: boolean,
	/** design/32: the build's version of THIS component (e.g. Zephyr "4.2.99"), for the fixedInVersion compare. */
	componentVersion?: string,
): ApplicabilityVerdict {
	// STRONGEST signal (P2): the upstream fix commit is in the tree → the CVE is patched, even if the version still
	// "matches" (a forked SDK backports without a version bump). Definitive exclusion — beats config/symbol.
	if (hint?.fixCommitSha && fixPresent === true) {
		return {
			signal: "fix-present",
			note: `the upstream fix commit (${hint.fixCommitSha.slice(0, 12)}) is present in your source tree — your build very likely already includes this fix; verify against the advisory.`,
		}
	}
	// design/32: the build's component version is AT OR PAST the version that fixes this CVE → already fixed. Cleaner
	// than a fix-commit for forks (no cherry-pick SHA ambiguity), and the only way to resolve an unversioned EUVD
	// discover-by-product lead. Curated from the advisory's "Patched versions"/"Affected <= X". Exclusion.
	if (hint?.fixedInVersion && componentVersion && semverGte(componentVersion, hint.fixedInVersion)) {
		return {
			signal: "version-fixed",
			note: `your build's version (${componentVersion}) is at or past the version that fixes this (${hint.fixedInVersion}) — very likely already fixed; verify against the advisory.`,
		}
	}
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
