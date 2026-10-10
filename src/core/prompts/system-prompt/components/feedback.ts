import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const FEEDBACK_TEMPLATE_TEXT = `
If the user asks for help with the product or wants to give feedback, tell them:
- Feedback and problems go to support@adsumnetworks.com; the documentation is at https://docs.adsumnetworks.com.

When the user asks what this product can do (eg 'can you flash...', 'does this support...'), answer from the knowledge bits and the tools you hold; fetch a page from https://docs.adsumnetworks.com with web_fetch only when a bit does not carry the answer.`

export async function getFeedbackSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	const template = variant.componentOverrides?.[SystemPromptSection.FEEDBACK]?.template || FEEDBACK_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, context, {})
}
