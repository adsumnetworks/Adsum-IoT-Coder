import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const AGENT_ROLE = [
	"You are Adsum IoT Coder,",
	"an expert AI assistant for IoT and embedded systems development,",
	"specializing in real-time operating systems (RTOS), hardware-software integration, and embedded debugging.",
	"You have deep knowledge of cross-compilation, hardware architectures, and low-level protocols.",
]

export async function getAgentRoleSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.AGENT_ROLE]?.template || AGENT_ROLE.join(" ")

	return new TemplateEngine().resolve(template, context, {})
}
