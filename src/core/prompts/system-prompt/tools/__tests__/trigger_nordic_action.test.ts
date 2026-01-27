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
		expect(generic?.description).to.include("COMMON BOARDS: nrf52dk, nrf52840dk")
		expect(generic?.description).to.include("west boards | grep <chip>")

		if (!generic) throw new Error("Generic variant not found")
		const commandParam = generic.parameters?.find((p) => p.name === "command")
		expect(commandParam).to.exist
		expect(commandParam?.instruction).to.include(`"west boards | grep nrf52840"`)
		expect(commandParam?.instruction).to.include(`"west build -b nrf52840dk ."`)
	})

	it("should have simplified description for NATIVE_GPT_5 variant", () => {
		const nativeGpt5 = trigger_nordic_action_variants.find((v) => v.variant === ModelFamily.NATIVE_GPT_5)
		expect(nativeGpt5).to.exist
		expect(nativeGpt5?.description).to.include("Execute commands in nRF Connect terminal")
		// The CLI Reference is reused, so it should have COMMON BOARDS too
		expect(nativeGpt5?.description).to.include("COMMON BOARDS: nrf52dk")
	})
})
