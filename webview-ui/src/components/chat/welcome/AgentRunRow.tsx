import { EmptyRequest } from "@shared/proto/cline/common"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha } from "../brandColors"

/**
 * The second run-path on a workflow card: run it with the developer's OWN coding agent.
 *
 * Rendered as a sibling row rather than inside the card (the card is a <button>; nesting one would be
 * invalid). Which door leads is decided by conductor mode:
 *   • conducting (no model configured) → the agent path is the ACTION (cyan), because it is the only
 *     way this card can actually run. The card above it stays available but is honestly secondary.
 *   • inference available → the agent path is a quiet alternative; the card remains primary.
 *
 * The "not-now" state is never hidden and never an error — it says what is missing and how to fix it.
 */
const AgentRunRow: React.FC<{ conducting: boolean }> = ({ conducting }) => {
	const { navigateToSettings } = useExtensionState()

	const handOver = () => StateServiceClient.handoverToAgent(EmptyRequest.create({})).catch(() => {})

	if (conducting) {
		return (
			<button
				onClick={handOver}
				style={{
					width: "100%",
					marginTop: "-4px",
					padding: "8px 12px",
					background: brandAlpha(BRAND_CYAN_600, 0.1),
					border: `1px solid ${brandAlpha(BRAND_CYAN_600, 0.45)}`,
					borderRadius: "9px",
					cursor: "pointer",
					textAlign: "left",
					display: "flex",
					flexDirection: "column",
					gap: "2px",
				}}
				title="Adsum posts the mission and the curated knowledge to your agent, gives it the toolchain, tracks every step and keeps snapshots"
				type="button">
				<span style={{ fontSize: "12px", fontWeight: 700, color: BRAND_CYAN_700 }}>Run with my coding agent →</span>
				<span style={{ fontSize: "10.5px", color: "var(--vscode-descriptionForeground)", lineHeight: 1.4 }}>
					Your agent does the work · Adsum guides it, tracks every step, keeps snapshots · no Adsum tokens
				</span>
			</button>
		)
	}

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "6px",
				marginTop: "-4px",
				padding: "0 3px",
				fontSize: "10.5px",
				color: "var(--vscode-descriptionForeground)",
			}}>
			<span>or</span>
			<button
				onClick={handOver}
				style={{
					background: "none",
					border: "none",
					padding: 0,
					cursor: "pointer",
					color: BRAND_CYAN_600,
					fontSize: "10.5px",
					fontWeight: 600,
					textDecoration: "underline",
				}}
				title="Hand this session to your own coding agent — Adsum keeps guiding, tracking and snapshotting"
				type="button">
				run it with my coding agent
			</button>
			<span>·</span>
			<button
				onClick={() => navigateToSettings("api-config")}
				style={{
					background: "none",
					border: "none",
					padding: 0,
					cursor: "pointer",
					color: "var(--vscode-descriptionForeground)",
					fontSize: "10.5px",
					textDecoration: "underline",
				}}
				type="button">
				models
			</button>
		</div>
	)
}

export default AgentRunRow
