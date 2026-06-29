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
 * Seed map: CVE/OSV id → verified hint. Entries are confirmed on a REAL build (design/16 + the 2026-06-27
 * NCS 3.2.1 / nrf52840dk verification). Grown by the §10 SBOM-feedback loop. Do NOT add speculative entries —
 * every codeSymbol below was confirmed ABSENT from a real linked image (including any `cc_`-prefixed HW-crypto
 * variants), so the engine's exclusion is a true "stripped/not-linked", not a false clear. NEVER map a CVE
 * whose affected code IS linked (e.g. the CTR_DRBG PRNG CVEs — `cc_mbedtls_ctr_drbg_*` is present → they must
 * stay "unknown"/review, not be cleared).
 */
export const ADVISORY_HINTS: Record<string, VerifiedAdvisoryHint> = {
	// mbed TLS — SSL/TLS context & session serialization (CVSS 9.8). The whole TLS layer is absent in a BLE app.
	"CVE-2026-34877": {
		codeSymbol: "mbedtls_ssl_context_save",
		verifiedNote:
			"Affects mbed TLS SSL/TLS context-and-session serialization (mbedtls_ssl_context_save/load). " +
			"Verified 2026-06-27 (NCS 3.2.1, nrf52840dk, central_uart + peripheral_uart): ZERO mbedtls_ssl_* symbols " +
			"linked — these are BLE apps with no TLS layer. Exclusion = not-linked.",
	},
	// mbed TLS — finite-field Diffie-Hellman (FFDH) contributory-behaviour flaw (CVSS 9.1). BLE uses ECDH, not FFDH.
	"CVE-2026-34872": {
		codeSymbol: "mbedtls_dhm_make_public",
		verifiedNote:
			"Affects mbed TLS finite-field DH (the DHM module, mbedtls_dhm_*). Verified 2026-06-27 (NCS 3.2.1, " +
			"nrf52840dk): no mbedtls_dhm_* symbols linked — BLE LE Secure Connections uses ECDH (bt_dh_key_gen), " +
			"NOT mbed TLS FFDH. Exclusion = not-linked.",
	},
	// hostap/hostapd — crafted-RADIUS-packet processing (no Wi-Fi on nRF52840; module listed in SBOM, code stripped).
	"CVE-2025-24912": {
		codeSymbol: "radius_msg_verify",
		verifiedNote:
			"Affects hostapd RADIUS packet processing. Verified 2026-06-27 (NCS 3.2.1, nrf52840dk): no hostap/hostapd " +
			"code linked — nRF52840 has no Wi-Fi; west spdx lists the hostap module from the manifest but its code is " +
			"gc-section stripped. Exclusion = not-linked.",
	},
	// Zephyr BLE host — fixed-channel (SMP/ATT) disconnect flaw (CVSS 7.1, EUVD-2025-30238). This is a POSITIVE
	// (config-present) hint, NOT an exclusion: the affected code is the BLE host's fixed-channel handling, compiled
	// whenever SMP is enabled. A BLE Central with pairing genuinely runs it → promotes this from a buried EUVD
	// lead to an actionable "may be reachable; verify". gc-section can't strip it (BLE is the app's core function).
	"CVE-2025-10456": {
		// GHSA-hcc8-3qr7-c9m8 (CVSS 7.1): a BLE fixed-channel (SMP/ATT) disconnect flaw whose actual bug is an
		// integer overflow in L2CAP credit handling (`le_credits`, subsys/bluetooth/host/l2cap.c, CWE-190). The gate
		// is therefore any BLE build (CONFIG_BT), not specifically SMP — l2cap.c is compiled in every BLE app.
		gateSymbol: "CONFIG_BT",
		// design/32: the GHSA states **Affected versions <= 4.1**, fix merged in PR 93576 → Zephyr **4.2.0**. So any
		// build on Zephyr >= 4.2.0 is past the fix. This resolves the unversioned EUVD lead by VERSION (cleaner than
		// a fix-commit SHA for forks): NCS v3.2.1 = Zephyr 4.2.99 → version-fixed → "very likely already fixed; verify".
		fixedInVersion: "4.2.0",
		verifiedNote:
			"Zephyr BLE L2CAP credit-overflow → fixed-channel disconnect (GHSA-hcc8-3qr7-c9m8, le_credits in " +
			"subsys/bluetooth/host/l2cap.c, CWE-190). GHSA: affected Zephyr <= 4.1, fixed in 4.2.0 (PR 93576). " +
			"Verified 2026-06-29: NCS v3.2.1 = Zephyr 4.2.99, which is >= 4.2.0 → version-fixed (very likely already " +
			"fixed; verify). On a build < 4.2.0 with CONFIG_BT=y it falls back to config-present (may be reachable).",
	},
}

/** Resolver wired into `runCveScan`. Returns a hint only for a verified CVE; unknown CVEs → undefined → "unknown". */
export const resolveAdvisoryHint: HintResolver = (vulnId) => {
	const hint = ADVISORY_HINTS[vulnId]
	if (!hint) {
		return undefined
	}
	// Strip the provenance field — the engine consumes gateSymbol/codeSymbol + P2 fixCommitSha + version-fixed.
	return {
		gateSymbol: hint.gateSymbol,
		codeSymbol: hint.codeSymbol,
		fixCommitSha: hint.fixCommitSha,
		fixedInVersion: hint.fixedInVersion,
	}
}
