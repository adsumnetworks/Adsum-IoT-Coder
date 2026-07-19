import type { Mode } from "@shared/storage/types"
import { BRAND_CORAL, BRAND_CYAN_600, brandAlpha } from "@/components/chat/brandColors"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ExternalAgentProviderProps {
	currentMode: Mode
	isPopup?: boolean
}

/**
 * Settings panel for the "Your own coding agent" provider (mcp-sdk/13).
 *
 * Deliberately has NO model picker, NO key, NO temperature: this provider never calls a model. Work is
 * handed to the developer's coding agent — their subscription runs it; Adsum conducts (curated
 * knowledge, toolchain commands, tracking, snapshots). What IS here: which agent, and what Adsum may
 * set up automatically for it.
 */
export const ExternalAgentProvider = ({ currentMode: _currentMode, isPopup: _isPopup }: ExternalAgentProviderProps) => {
	const { apiConfiguration, handoverUi } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const kind = apiConfiguration?.externalAgentKind === "other" ? "other" : "claude-code"
	const autoMcp = apiConfiguration?.externalAgentAutoMcp !== false
	const manageClaudeMd = apiConfiguration?.externalAgentManageClaudeMd !== false
	const writeAgentsMd = apiConfiguration?.externalAgentWriteAgentsMd === true
	const detected = handoverUi?.agent

	const toggle = (opts: { checked: boolean; label: string; sub: string; onChange: (v: boolean) => void }) => (
		<label style={{ display: "flex", gap: "8px", alignItems: "flex-start", cursor: "pointer", padding: "4px 0" }}>
			<input
				checked={opts.checked}
				onChange={(e) => opts.onChange(e.target.checked)}
				style={{ marginTop: "3px", accentColor: BRAND_CYAN_600 }}
				type="checkbox"
			/>
			<span style={{ flex: 1, minWidth: 0 }}>
				<span style={{ display: "block", fontSize: "12px", color: "var(--vscode-foreground)" }}>{opts.label}</span>
				<span
					style={{
						display: "block",
						fontSize: "10.5px",
						color: "var(--vscode-descriptionForeground)",
						lineHeight: 1.45,
					}}>
					{opts.sub}
				</span>
			</span>
		</label>
	)

	return (
		<div
			className="p-3 rounded-md"
			style={{
				background: "var(--vscode-textBlockQuote-background)",
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.4)}`,
			}}>
			<p className="m-0 mb-1 font-semibold" style={{ color: "var(--vscode-foreground)" }}>
				Your coding agent runs the work
			</p>
			<p className="m-0 mb-3 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
				Cards and typed tasks are handed to your agent on <strong>your</strong> subscription — no Adsum tokens. Adsum
				conducts: curated knowledge, toolchain commands, live tracking, safety snapshots.
			</p>

			{/* which agent */}
			<div className="mb-3">
				<span
					style={{
						display: "block",
						fontSize: "10px",
						textTransform: "uppercase",
						letterSpacing: "0.5px",
						fontWeight: 700,
						color: "var(--vscode-descriptionForeground)",
						marginBottom: "4px",
					}}>
					Agent
				</span>
				<select
					onChange={(e) => handleFieldChange("externalAgentKind", e.target.value as "claude-code" | "other")}
					style={{
						width: "100%",
						padding: "4px 8px",
						background: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: "4px",
						fontSize: "12px",
					}}
					value={kind}>
					<option value="claude-code">Claude Code</option>
					<option value="other">Another MCP-capable agent</option>
				</select>
				{kind === "claude-code" ? (
					<p className="m-0 mt-1 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
						{detected?.present
							? `✓ Claude Code detected (${detected.how ?? "on this machine"})`
							: "Claude Code was not found on this machine — install it, or pick another agent."}
					</p>
				) : (
					<p className="m-0 mt-1 text-xs" style={{ color: "var(--vscode-descriptionForeground)", lineHeight: 1.5 }}>
						Add the Adsum server to your agent's MCP configuration yourself:{" "}
						<code style={{ fontSize: "10px" }}>node &lt;extension&gt;/mcp/adsum-mcp.mjs</code> (stdio). The handover
						toast shows the exact installed path.
					</p>
				)}
			</div>

			{/* what Adsum may set up automatically */}
			{kind === "claude-code" ? (
				<div className="mb-2">
					<span
						style={{
							display: "block",
							fontSize: "10px",
							textTransform: "uppercase",
							letterSpacing: "0.5px",
							fontWeight: 700,
							color: "var(--vscode-descriptionForeground)",
							marginBottom: "2px",
						}}>
						Automatic setup, per project
					</span>
					{toggle({
						checked: autoMcp,
						label: "Register Adsum with Claude Code",
						sub: "Writes the adsum server into the project's .mcp.json when you hand work over — no JSON editing. Other servers there are preserved.",
						onChange: (v) => handleFieldChange("externalAgentAutoMcp", v),
					})}
					{toggle({
						checked: manageClaudeMd,
						label: "Maintain the guidance block in CLAUDE.md",
						sub: "A fenced, fingerprinted block telling your agent how to work with Adsum (check the inbox, load curated knowledge, report milestones). Your own edits inside it are never overwritten.",
						onChange: (v) => handleFieldChange("externalAgentManageClaudeMd", v),
					})}
					{toggle({
						checked: writeAgentsMd,
						label: "Also write AGENTS.md",
						sub: "The same guidance block in the cross-agent convention file, for agents that read AGENTS.md instead.",
						onChange: (v) => handleFieldChange("externalAgentWriteAgentsMd", v),
					})}
				</div>
			) : null}

			<p className="m-0 text-xs" style={{ color: "var(--vscode-descriptionForeground)", lineHeight: 1.5 }}>
				One honest beat we can't automate: an agent loads its MCP servers when a session starts — an already-open session
				needs one restart to see Adsum.
			</p>
		</div>
	)
}
