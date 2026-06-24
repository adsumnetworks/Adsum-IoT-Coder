/**
 * CRA artifact output paths — the directory the CRA bits (cra-readiness.md, cra-generate-sbom.md) write into.
 * The host observes PRESENCE / path-shape only (it never reads contents). Single source of truth so a bit
 * rename is changed in ONE place; keep in sync with the knowledge-bit output path.
 */
export const CRA_ARTIFACT_DIR = "compliance"
export const CRA_SBOM_SUBDIR = `${CRA_ARTIFACT_DIR}/sbom`
