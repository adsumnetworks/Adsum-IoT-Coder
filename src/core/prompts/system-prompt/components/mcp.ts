import type { McpServer } from "@/shared/mcp"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

/**
 * Checks if there are any enabled MCP servers in the context.
 * This is a utility function to standardize MCP server detection across all prompt variants.
 *
 * @param context - The system prompt context
 * @returns true if there are enabled MCP servers, false otherwise
 *
 * @example
 * const hasMcp = hasEnabledMcpServers(context)
 * if (hasMcp) {
 *   // Include MCP-specific instructions
 * }
 */
export function hasEnabledMcpServers(context: SystemPromptContext): boolean {
	return (context.mcpHub?.getServers() || []).length > 0
}

const MCP_TEMPLATE_TEXT = `MCP SERVERS

The Model Context Protocol (MCP) enables communication between the system and locally running MCP servers that provide additional tools and resources to extend your capabilities.

# Connected MCP Servers

When a server is connected, you can use the server's tools via the \`use_mcp_tool\` tool, and access the server's resources via the \`access_mcp_resource\` tool.

{{MCP_SERVERS_LIST}}`

export async function getMcp(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	const servers = context.mcpHub?.getServers() || []
	// Skip the section if there are no servers connected / available
	if (servers.length === 0) {
		return undefined
	}
	return await getMcpServers(servers, variant, context)
}

/**
 * True when this request will also ship every MCP tool as a NATIVE tool definition.
 *
 * Mirrors the exact gate in `ClineToolSet.getNativeTools` — the variant must advertise
 * `use_native_tools` AND the user setting must be on. When both hold, each connected MCP
 * tool's `inputSchema` is already sent as structured tool JSON, so repeating the same
 * schema inside the prompt TEXT paid for it twice on every single request.
 */
export function nativeToolDefsCarryMcpSchemas(variant: PromptVariant, context: SystemPromptContext): boolean {
	return variant.labels?.["use_native_tools"] === 1 && context.enableNativeToolCalls === true
}

async function getMcpServers(servers: McpServer[], variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.MCP]?.template || MCP_TEMPLATE_TEXT

	// In native mode keep the server + tool NAMES and descriptions — the model still has to know
	// which servers exist and what each one is for — but drop the JSON schemas the native tool
	// definitions already carry. In XML mode the prompt text is the ONLY place the schemas exist,
	// so it is emitted byte-for-byte as before.
	const includeSchemas = !nativeToolDefsCarryMcpSchemas(variant, context)
	const serversList =
		servers.length > 0 ? formatMcpServersList(servers, includeSchemas) : "(No MCP servers currently connected)"
	return new TemplateEngine().resolve(template, context, {
		MCP_SERVERS_LIST: serversList,
	})
}

function formatMcpServersList(servers: McpServer[], includeSchemas: boolean): string {
	return servers
		.filter((server) => server.status === "connected")
		.map((server) => {
			const tools = server.tools
				?.map((tool) => {
					const schemaStr =
						includeSchemas && tool.inputSchema
							? `    Input Schema:
    ${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}`
							: ""

					return `- ${tool.name}: ${tool.description}\n${schemaStr}`
				})
				.join("\n\n")

			const templates = server.resourceTemplates
				?.map((template) => `- ${template.uriTemplate} (${template.name}): ${template.description}`)
				.join("\n")

			const resources = server.resources
				?.map((resource) => `- ${resource.uri} (${resource.name}): ${resource.description}`)
				.join("\n")

			const config = JSON.parse(server.config)

			return (
				`## ${server.name}` +
				(config.command
					? ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)`
					: "") +
				(tools ? `\n\n### Available Tools\n${tools}` : "") +
				(templates ? `\n\n### Resource Templates\n${templates}` : "") +
				(resources ? `\n\n### Direct Resources\n${resources}` : "")
			)
		})
		.join("\n\n")
}
