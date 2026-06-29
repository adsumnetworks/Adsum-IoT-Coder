import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { classifyCraArtifactPath, commandGeneratesCraSbom, commandWritesCraReport } from "./craArtifact"

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

	test("dated run-folder (design/29): compliance/cra-<date>/sbom + remediation still classify", () => {
		assert.equal(classifyCraArtifactPath("/proj/compliance/cra-2026-06-29/sbom/all.spdx"), "sbom")
		assert.equal(classifyCraArtifactPath("/proj/compliance/cra-2026-06-29/cra-remediation-2026-06-29.md"), "fix")
		// the dated segment is optional — the flat layout still works (covered above), and a non-sbom md is null
		assert.equal(classifyCraArtifactPath("/proj/compliance/cra-2026-06-29/CRA_READINESS.md"), null)
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

describe("commandWritesCraReport (design/25 T2a — shell-redirect backstop)", () => {
	test("a shell write of the readiness report → true (must be refused; the guard only runs on write_to_file)", () => {
		assert.equal(commandWritesCraReport('echo "# CRA SBOM & Fix" > compliance/CRA_READINESS.md'), true)
		assert.equal(commandWritesCraReport("cat report.md >> compliance/CRA_READINESS.md"), true)
		assert.equal(commandWritesCraReport("printf '%s' x | tee compliance/CRA_READINESS.md"), true)
		assert.equal(commandWritesCraReport("cp /tmp/draft.md compliance/CRA_READINESS.md"), true)
		assert.equal(commandWritesCraReport("mv cra-readiness-2026-06-28.md compliance/"), true) // retitled variant
	})
	test("reads, SBOM writes, and non-report writes → false (no false-positives on the golden path)", () => {
		assert.equal(commandWritesCraReport("cat compliance/CRA_READINESS.md"), false) // reading is fine
		assert.equal(commandWritesCraReport("west spdx -d build -o compliance/sbom/app.spdx"), false) // SBOM, not the report
		assert.equal(commandWritesCraReport("echo hi > notes.txt"), false)
		assert.equal(commandWritesCraReport("ls compliance/"), false)
	})
})
