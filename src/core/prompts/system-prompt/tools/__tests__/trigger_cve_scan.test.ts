import { expect } from "chai"
import { describe, it } from "mocha"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { trigger_cve_scan_variants } from "../trigger_cve_scan"

describe("trigger_cve_scan tool", () => {
	it("exports variants for GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3", () => {
		const variants = trigger_cve_scan_variants.map((v) => v.variant)
		expect(variants).to.include(ModelFamily.GENERIC)
		expect(variants).to.include(ModelFamily.NATIVE_GPT_5)
		expect(variants).to.include(ModelFamily.NATIVE_NEXT_GEN)
		expect(variants).to.include(ModelFamily.GEMINI_3)
	})

	it("every variant is the CVE_SCAN tool with a context gate", () => {
		for (const v of trigger_cve_scan_variants) {
			expect(v.id).to.equal(ClineDefaultTool.CVE_SCAN)
			expect(v.contextRequirements, `${v.variant} should be context-gated`).to.be.a("function")
		}
	})

	it("GENERIC variant: correct id/name + evidence-mode, SBOM-first description", () => {
		const generic = trigger_cve_scan_variants.find((v) => v.variant === ModelFamily.GENERIC)
		expect(generic).to.exist
		if (!generic) throw new Error("GENERIC variant not found")
		expect(generic.id).to.equal(ClineDefaultTool.CVE_SCAN)
		expect(generic.name).to.equal("triggerCveScan")
		expect(generic.description).to.match(/evidence-mode/i)
		expect(generic.description).to.match(/SBOM/)
		// Honesty cues must be in the model-facing description.
		expect(generic.description).to.match(/attributed/i)
		expect(generic.description).to.match(/never asserts "not affected"/i)
	})

	it("has a required `sbom` param and an optional `build` param on every variant", () => {
		for (const v of trigger_cve_scan_variants) {
			const sbom = v.parameters?.find((p) => p.name === "sbom")
			const build = v.parameters?.find((p) => p.name === "build")
			expect(sbom, `${v.variant} missing sbom param`).to.exist
			expect(sbom?.required).to.equal(true)
			expect(build, `${v.variant} missing build param`).to.exist
			expect(build?.required).to.equal(false)
		}
	})

	it("context gate returns a boolean (does not throw)", () => {
		const generic = trigger_cve_scan_variants.find((v) => v.variant === ModelFamily.GENERIC)
		// contextRequirements takes the SystemPromptContext but our gate ignores it; calling with {} must be safe.
		expect(generic?.contextRequirements?.({} as never)).to.be.a("boolean")
	})
})
