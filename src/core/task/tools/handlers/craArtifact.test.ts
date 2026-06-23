import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { classifyCraArtifactPath } from "./craArtifact"

/**
 * C3 — the CRA funnel path-classifier (the pure logic behind cra_sbom_generated / cra_fix_completed).
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/tools/handlers/craArtifact.test.ts
 */
describe("classifyCraArtifactPath", () => {
	test("SBOM files under compliance/sbom/ → 'sbom'", () => {
		assert.equal(classifyCraArtifactPath("/proj/compliance/sbom/app.spdx"), "sbom")
		assert.equal(classifyCraArtifactPath("/proj/compliance/sbom/sbom_report.html"), "sbom")
		assert.equal(classifyCraArtifactPath("/tmp/cra-src/x/compliance/sbom/zephyr.spdx"), "sbom")
	})

	test("Windows back-slash paths normalise → 'sbom'", () => {
		assert.equal(classifyCraArtifactPath("C:\\proj\\compliance\\sbom\\app.spdx"), "sbom")
	})

	test("remediation handoff → 'fix'", () => {
		assert.equal(classifyCraArtifactPath("/proj/compliance/cra-remediation-2026-06-23.md"), "fix")
		assert.equal(classifyCraArtifactPath("/proj/compliance/cra-remediation.md"), "fix")
	})

	test("everything else → null", () => {
		assert.equal(classifyCraArtifactPath("/proj/src/main.c"), null)
		assert.equal(classifyCraArtifactPath("/proj/compliance/CRA_READINESS.md"), null)
		// cra-readiness.json must NEVER classify — telemetry must not key on it (it may never be written).
		assert.equal(classifyCraArtifactPath("/proj/compliance/cra-readiness.json"), null)
		// a file literally named sbom.md (not the compliance/sbom/ DIRECTORY) must not match.
		assert.equal(classifyCraArtifactPath("/proj/compliance/sbom.md"), null)
		// the remediation pattern is .md only — a stray .txt handoff doesn't count.
		assert.equal(classifyCraArtifactPath("/proj/compliance/cra-remediation-2026.txt"), null)
	})
})
