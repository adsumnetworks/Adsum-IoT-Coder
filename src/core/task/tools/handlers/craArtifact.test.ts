import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { classifyCraArtifactPath, commandGeneratesCraSbom } from "./craArtifact"

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

	test("relative paths (apply_patch may pass these) → classified too", () => {
		assert.equal(classifyCraArtifactPath("compliance/sbom/app.spdx"), "sbom")
		assert.equal(classifyCraArtifactPath("compliance/cra-remediation-2026-06-23.md"), "fix")
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

describe("commandGeneratesCraSbom", () => {
	test("the golden-path SBOM tools → true", () => {
		assert.equal(commandGeneratesCraSbom("west ncs-sbom -d build --output-spdx compliance/sbom/app.spdx"), true)
		assert.equal(
			commandGeneratesCraSbom("esp-idf-sbom create build/project_description.json -o compliance/sbom/app.spdx"),
			true,
		)
		assert.equal(commandGeneratesCraSbom("idf.py sbom-create"), true) // ESP native wrapper for esp-idf-sbom
		assert.equal(commandGeneratesCraSbom("west spdx -d build/central_uart"), true)
	})
	test("non-SBOM / read-only commands → false", () => {
		assert.equal(commandGeneratesCraSbom("west build -d build -b nrf52840dk ."), false)
		assert.equal(commandGeneratesCraSbom("cat compliance/sbom/app.spdx"), false)
		assert.equal(commandGeneratesCraSbom("ls compliance/sbom/"), false)
		assert.equal(commandGeneratesCraSbom("idf.py build"), false)
	})
})
