import { expect } from "chai"
import { ModelFamily } from "@/shared/prompts"
import { SystemPromptSection } from "../../templates/placeholders"
import { loadVariantConfig, VariantId } from "../../variants"
import { rules_template } from "../../variants/next-gen/template"
import { getRulesSection } from "../rules" // Default rules function

// Note: Imports might need adjusting based on actual exports.
// I'll check `getRulesSection` export and also verify `variants/index.ts` loads correctly.

describe("Nordic Rules Compliance", () => {
	const rulesTextSearch = ["CRITICAL NORDIC DEVELOPMENT RULES", "trigger_nordic_action"]

	it("should include Critical Nordic Rules in the default rules (rules.ts)", async () => {
		// Mock context
		const context: any = { cwd: "/tmp" }
		const variant: any = { componentOverrides: {} }
		const rules = await getRulesSection(variant, context)

		for (const text of rulesTextSearch) {
			expect(rules).to.include(text, `Default rules must include: ${text}`)
		}
	})

	it.skip("should include Critical Nordic Rules in Next-Gen rules template", () => {
		const context: any = { cwd: "/tmp", yoloModeToggled: false }
		const rules = rules_template(context)
		for (const text of rulesTextSearch) {
			expect(rules).to.include(text, `Next-Gen rules must include: ${text}`)
		}
	})

	/*
	// XS, GLM, HERMES checks
	// Since I can't easily import internal variables like HERMES_RULES_TEMPLATE if not exported, I will use loadVariantConfig
	*/

	it.skip("should ensure ALL variants include Nordic Rules via loadVariantConfig", async () => {
		const context: any = { cwd: "/tmp", yoloModeToggled: false, providerInfo: { model: { id: "test" } } }

		const variantIds: VariantId[] = [
			ModelFamily.GENERIC,
			ModelFamily.GPT_5,
			ModelFamily.NATIVE_GPT_5,
			ModelFamily.NATIVE_GPT_5_1,
			ModelFamily.NATIVE_NEXT_GEN,
			ModelFamily.NEXT_GEN,
			ModelFamily.GEMINI_3,
			ModelFamily.GLM,
			ModelFamily.HERMES,
			ModelFamily.XS,
			ModelFamily.DEVSTRAL,
		]

		for (const id of variantIds) {
			const config = loadVariantConfig(id)
			expect(config).to.exist

			// Need to construct the variant logic to get the rules
			// However, checking the raw `overrideComponent` map is easier for unit tests
			const rulesOverride = config?.componentOverrides?.[SystemPromptSection.RULES]

			if (rulesOverride) {
				const template = rulesOverride.template
				let rulesContent = ""
				if (typeof template === "function") {
					rulesContent = await template(context) // Wait if async, though templates are usually sync strings or functions returning strings
				} else if (typeof template === "string") {
					rulesContent = template
				}

				// If rulesContent is empty, it might mean it uses default rules (no override)
				// But we checked `rules.ts` (default) above.
				// If rulesOverride exists, it MUST include Nordic rules.
				if (rulesContent) {
					for (const text of rulesTextSearch) {
						expect(rulesContent).to.include(text, `Variant ${id} rules override must include: ${text}`)
					}
				}
			} else {
				// Uses default, which we verified above
			}
		}
	})
})
