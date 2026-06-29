/**
 * CRA funnel artifact classification — pure + tested. Given a written file's absolute path, decide which
 * CRA milestone (if any) it represents, so the host can fire the funnel telemetry keyed on the OUTPUT
 * artifact path. The path is a LOCAL trigger only — it is never put in the telemetry payload.
 *
 * Extracted from WriteToFileToolHandler so the path-detection (the part that matters) is unit-testable
 * without the handler's heavy import graph / live telemetry. See design/08 + the pinned {surface,key} table.
 */
import { CRA_ARTIFACT_DIR } from "@shared/cra-paths"

export type CraArtifactKind = "sbom" | "fix" | null

// Built from the shared CRA path constants so a bit-side dir rename changes ONE place (see @shared/cra-paths).
// `(?:[^/]+/)?` allows an optional dated run-folder segment (design/29: `compliance/cra-<date>/sbom/…` and
// `compliance/cra-<date>/cra-remediation-*.md`) as well as the flat `compliance/sbom/…` layout.
const SBOM_PATH_RE = new RegExp(`(^|/)${CRA_ARTIFACT_DIR}/(?:[^/]+/)?sbom/`)
const FIX_PATH_RE = new RegExp(`(^|/)${CRA_ARTIFACT_DIR}/(?:[^/]+/)?cra-remediation[^/]*\\.md$`)

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

// The CRA readiness report filename(s) — the exact `CRA_READINESS.md` plus the retitled variants real runs used
// (`cra-readiness-<date>.md`, `cra-sbom*.md`). The host honesty/integrity guard ONLY runs on a `write_to_file` of
// this report; a shell write (`echo … > …`, `tee`, `cp`, `mv`, heredoc) skips the write seam entirely.
const CRA_REPORT_FILE_RE = /(?:CRA_READINESS|cra[_-]?readiness|cra[_-]?sbom)[^\s'"]*\.md\b/i
// A shell write MECHANISM (so `cat …/CRA_READINESS.md` is NOT flagged — only writes).
const SHELL_WRITE_OP_RE = /(?:>>?|\btee\b|\bdd\b[^|]*\bof=|\bcp\b|\bmv\b|\binstall\b)/i

/**
 * True if a shell command would WRITE the CRA readiness report (vs the model using `write_to_file`). The guarded
 * write seam (WriteToFileToolHandler → reportIntegrity) never sees a shell write, so a model that shell-redirects
 * around it ships the report UNGUARDED — a real failure mode (2706n). The bits forbid this; this is the host
 * backstop. Keyed on the report filename + a write operator to keep false-positives low (an `.spdx` SBOM written
 * via shell into `compliance/sbom/` is the legitimate golden path and is NOT matched — it's not a `*readiness*.md`).
 * A generic-rename-via-shell (`> compliance/foo.md`) remains a rarer residual the content classifier catches on
 * the write_to_file path.
 */
export function commandWritesCraReport(command: string): boolean {
	return CRA_REPORT_FILE_RE.test(command) && SHELL_WRITE_OP_RE.test(command)
}
