import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseFormattingSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	// Return the placeholder that will be replaced with actual tools
	const template = TOOL_USE_FORMATTING_TEMPLATE_TEXT

	const focusChainEnabled = context.focusChainSettings?.enabled

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, context, {
		FOCUS_CHATIN_FORMATTING: focusChainEnabled ? FOCUS_CHATIN_FORMATTING_TEMPLATE : "",
	})
}

const FOCUS_CHATIN_FORMATTING_TEMPLATE = `<task_progress>
Checklist here (optional)
</task_progress>
`

const TOOL_USE_FORMATTING_TEMPLATE_TEXT = `# Tool Use Formatting

Tool use is formatted as XML. The tag name IS the actual tool name (e.g. \`read_file\`), and each parameter is its own nested tag whose tag name IS the parameter name (e.g. \`path\`). You must substitute the real tool and parameter names — do NOT output the literal words \`tool_name\`, \`parameter_name\`, \`TOOL_NAME\`, or any other placeholder text from this guide.

Correct examples:

<read_file>
<path>src/main.js</path>
{{FOCUS_CHATIN_FORMATTING}}</read_file>

<execute_command>
<command>ls -la</command>
<requires_approval>false</requires_approval>
</execute_command>

General shape — the UPPERCASE words below are placeholders to substitute, not literal text:

<TOOL_NAME>
<FIRST_PARAM_NAME>first param value</FIRST_PARAM_NAME>
<SECOND_PARAM_NAME>second param value</SECOND_PARAM_NAME>
</TOOL_NAME>

Common mistakes to avoid:
- Do NOT emit \`<tool_name>read_file</tool_name>\` — the tag name itself must be \`read_file\`, not the placeholder \`tool_name\`.
- Do NOT emit \`<parameter_name>path>...</parameter_name>\` — the tag name must be \`path\`, written as \`<path>...</path>\`.
- Open and close tags must match exactly (\`<read_file>...</read_file>\`, not \`<read_file>...</parameter_name>\`).

Always follow this format so the tool call can be parsed and executed.`
