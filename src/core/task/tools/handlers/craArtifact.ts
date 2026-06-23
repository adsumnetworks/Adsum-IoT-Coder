/**
 * CRA funnel artifact classification — pure + tested. Given a written file's absolute path, decide which
 * CRA milestone (if any) it represents, so the host can fire the funnel telemetry keyed on the OUTPUT
 * artifact path. The path is a LOCAL trigger only — it is never put in the telemetry payload.
 *
 * Extracted from WriteToFileToolHandler so the path-detection (the part that matters) is unit-testable
 * without the handler's heavy import graph / live telemetry. See design/08 + the pinned {surface,key} table.
 */
export type CraArtifactKind = "sbom" | "fix" | null

/**
 * - `"sbom"` — an SBOM file under `compliance/sbom/` (the door cleared).
 * - `"fix"`  — a remediation handoff `compliance/cra-remediation-*.md` (the spine's handoff step).
 * - `null`   — anything else (most writes).
 * Never matches `cra-readiness.json` (telemetry must never key on it — it may never be written on the
 * preview-and-ask path).
 */
export function classifyCraArtifactPath(absolutePath: string): CraArtifactKind {
	const norm = absolutePath.replace(/\\/g, "/")
	if (/\/compliance\/sbom\//.test(norm)) {
		return "sbom"
	}
	if (/\/compliance\/cra-remediation[^/]*\.md$/.test(norm)) {
		return "fix"
	}
	return null
}
