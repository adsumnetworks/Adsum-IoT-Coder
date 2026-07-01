import { espToolActive, nrfToolActive } from "@/services/platform/platformRouting"
import { getCachedWorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * CVE scan tool spec (CVE scan loop — design/15). The HOST runs the scan (normalize SBOM → OSV → applicability →
 * evidence) and writes `compliance/cve-scan-<date>.{md,json}`; the model triggers it and presents the result
 * (D11-R — the model never fabricates a CVE).
 *
 * Advertised on the same predicate as the nRF/ESP device tools (nrf/esp/both/none) — i.e. wherever a firmware
 * SBOM could plausibly exist. `CVE_SCAN_TOOL_ENABLED` remains as a single kill-switch. Output is honest by
 * construction (attributed + dated + hedged, verdictScan-clean); the design/16 spike further TUNES precision
 * (linked-symbol soundness, real fixture swap) but is not a correctness gate for the hedged output.
 */
const CVE_SCAN_TOOL_ENABLED = true

const isCveScanActive = (): boolean => {
	if (!CVE_SCAN_TOOL_ENABLED) {
		return false
	}
	const summary = getCachedWorkspaceSummary()
	return nrfToolActive(summary) || espToolActive(summary)
}

const TECHNICAL_REFERENCE = `
Evidence-mode only. Every advisory is attributed to its source (OSV), dated ("as of"), and hedged ("verify") —
this is a triage aid, never a clean bill of health. Run the CRA SBOM step FIRST (this needs a generated SBOM).
Pass "build" (the verified build dir) so applicability can use the merged .config + ELF symbols to rule things
OUT (config-disabled / symbol-stripped ⇒ "likely not applicable; verify") — it never asserts "not affected".
Components without a PURL (CPE-only / unidentified) are reported as an honest coverage gap, not silently dropped.
`

const PARAMETERS = [
	{
		name: "sbom",
		required: true,
		instruction:
			"Path to the SBOM to scan (SPDX tag-value or JSON), e.g. compliance/sbom/app.spdx — generate it first via the CRA SBOM step.",
		usage: "compliance/sbom/app.spdx",
	},
	{
		name: "build",
		required: false,
		instruction:
			"The verified build directory (e.g. build or build/<image>). Supplies the merged .config + ELF symbols for applicability. Omit if there is no build.",
		usage: "build",
	},
]

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.CVE_SCAN,
	name: "triggerCveScan",
	contextRequirements: isCveScanActive,
	description: `Scan a generated SBOM for known CVEs (host-run, evidence-mode).
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.CVE_SCAN,
	name: ClineDefaultTool.CVE_SCAN,
	contextRequirements: isCveScanActive,
	description: `Scan a generated SBOM for known CVEs (host-run, evidence-mode).
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.CVE_SCAN,
	name: ClineDefaultTool.CVE_SCAN,
	contextRequirements: isCveScanActive,
	description: `Scan a generated SBOM for known CVEs (host-run, evidence-mode).
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

export const trigger_cve_scan_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
