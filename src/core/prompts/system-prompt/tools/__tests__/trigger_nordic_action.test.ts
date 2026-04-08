import { expect } from "chai"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { trigger_nordic_action_variants } from "../trigger_nordic_action"

describe("trigger_nordic_action tool", () => {
	it("should export variants for GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3", () => {
		const variants = trigger_nordic_action_variants.map((v) => v.variant)
		expect(variants).to.include(ModelFamily.GENERIC)
		expect(variants).to.include(ModelFamily.NATIVE_GPT_5)
		expect(variants).to.include(ModelFamily.NATIVE_NEXT_GEN)
		expect(variants).to.include(ModelFamily.GEMINI_3)
	})

	it("should have correct description and parameters for GENERIC variant", () => {
		const generic = trigger_nordic_action_variants.find((v) => v.variant === ModelFamily.GENERIC)
		expect(generic).to.exist
		expect(generic?.id).to.equal(ClineDefaultTool.NORDIC_ACTION)

		expect(generic?.description).to.include("Execute commands in the nRF Connect terminal")
		expect(generic?.description).to.include('USE action="execute" for ALL NCS CLI')
		expect(generic?.description).to.include("NEVER use execute_command for NCS SDK tasks")
		expect(generic?.description).to.include("taskkill /F /IM JLink.exe")

		if (!generic) throw new Error("Generic variant not found")

		// Should have action and operation parameters
		const actionParam = generic.parameters?.find((p) => p.name === "action")
		expect(actionParam).to.exist

		const operationParam = generic.parameters?.find((p) => p.name === "operation")
		expect(operationParam).to.exist
		expect(operationParam?.instruction).to.include("capture")
	})

	it("should have simplified description for NATIVE_GPT_5 variant", () => {
		const nativeGpt5 = trigger_nordic_action_variants.find((v) => v.variant === ModelFamily.NATIVE_GPT_5)
		expect(nativeGpt5).to.exist
		// Tool handles both execute and capture
		expect(nativeGpt5?.description).to.include("Execute commands in the nRF Connect terminal")
		expect(nativeGpt5?.description).to.include("NEVER use execute_command for NCS SDK tasks")
	})
})
