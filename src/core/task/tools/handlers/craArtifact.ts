/**
 * CRA funnel artifact classification — pure + tested. Given a written file's absolute path, decide which
 * CRA milestone (if any) it represents, so the host can fire the funnel telemetry keyed on the OUTPUT
 * artifact path. The path is a LOCAL trigger only — it is never put in the telemetry payload.
 *
 * Extracted from WriteToFileToolHandler so the path-detection (the part that matters) is unit-testable
 * without the handler's heavy import graph / live telemetry. See design/08 + the pinned {surface,key} table.
 */
import { CRA_ARTIFACT_DIR, CRA_SBOM_SUBDIR } from "@shared/cra-paths"

export type CraArtifactKind = "sbom" | "fix" | null

// Built from the shared CRA path constants so a bit-side dir rename changes ONE place (see @shared/cra-paths).
const SBOM_PATH_RE = new RegExp(`(^|/)${CRA_SBOM_SUBDIR}/`)
const FIX_PATH_RE = new RegExp(`(^|/)${CRA_ARTIFACT_DIR}/cra-remediation[^/]*\\.md$`)

/**
 * - `"sbom"` — an SBOM file under `compliance/sbom/` (the door cleared).
 * - `"fix"`  — a remediation handoff `compliance/cra-remediation-*.md` (the spine's handoff step).
 * - `null`   — anything else (most writes).
 * Never matches `cra-readiness.json` (telemetry must never key on it — it may never be written on the
 * preview-and-ask path).
 */
export function classifyCraArtifactPath(absolutePath: string): CraArtifactKind {
	const norm = absolutePath.replace(/\\/g, "/")
	// `(^|/)` so it matches both absolute (/proj/compliance/sbom/…) and relative (compliance/sbom/…) paths.
	if (SBOM_PATH_RE.test(norm)) {
		return "sbom"
	}
	if (FIX_PATH_RE.test(norm)) {
		return "fix"
	}
	return null
}

/**
 * True if a shell command GENERATES an SBOM — the golden path writes it via a tool, not write_to_file, so
 * the write-path classifier above never sees it. We key on the **tool invocation** (robust; fires when the
 * SBOM is produced, before any `cp` to compliance/sbom/): nRF `west ncs-sbom`, ESP `esp-idf-sbom`, or the
 * `west spdx` fallback. (The SBOM-lite markdown fallback IS written via write_to_file → covered by the path
 * classifier.) Pure + tested. Read-only commands like `cat …/x.spdx` are intentionally NOT matched.
 */
export function commandGeneratesCraSbom(command: string): boolean {
	return (
		/\bncs-sbom\b/i.test(command) || // nRF: west ncs-sbom
		/\besp-idf-sbom\b/i.test(command) || // ESP: esp-idf-sbom create
		/\bsbom-create\b/i.test(command) || // ESP native wrapper: idf.py sbom-create
		/\bwest\s+spdx\b/i.test(command) // fallback A: west spdx
	)
}
