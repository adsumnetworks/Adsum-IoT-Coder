import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, brandAlpha } from "../brandColors"
import EnvStrip from "./EnvStrip"

interface StatusHeaderProps {
	projectName: string | null
}

/**
 * Conductor pill — shown only when Adsum has no model of its own, so the developer's coding agent is
 * how work actually runs here. Coral outline: this is IDENTITY (what Adsum is being right now), not a
 * status or a warning. It states a mode, it never asks for anything.
 */
const ConductorPill: React.FC<{ reason: string }> = ({ reason }) => (
	<span
		style={{
			display: "inline-flex",
			alignItems: "center",
			gap: "5px",
			alignSelf: "flex-start",
			fontSize: "10.5px",
			color: "var(--vscode-descriptionForeground)",
			// No fill: --vscode-badge-background is a saturated accent in many themes (a blue block in
			// light ones), which both fights coral and buries the text. A hairline coral border carries
			// the identity signal on any background — same recipe as KbitPill.
			background: "transparent",
			border: `1px solid ${brandAlpha(BRAND_CORAL, 0.4)}`,
			padding: "2px 9px",
			borderRadius: "20px",
			whiteSpace: "nowrap",
		}}
		title={`${reason}. Your own coding agent runs the work; Adsum guides it with curated knowledge, gives it the toolchain, tracks every step and keeps snapshots. No Adsum tokens are used.`}>
		conducting for <strong style={{ color: BRAND_CORAL, fontWeight: 700 }}>your agent</strong>
	</span>
)

const StatusHeader: React.FC<StatusHeaderProps> = ({ projectName }) => {
	const { handoverUi } = useExtensionState()
	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				marginBottom: "8px",
			}}>
			{projectName && (
				<div
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						display: "flex",
						alignItems: "center",
						gap: "6px",
					}}>
					<i className="codicon codicon-folder" style={{ fontSize: "13px", color: "var(--vscode-foreground)" }} />
					<span
						style={{
							fontWeight: 600,
							color: "var(--vscode-foreground)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}>
						{projectName}
					</span>
				</div>
			)}
			{handoverUi?.conductor.active && <ConductorPill reason={handoverUi.conductor.reason} />}
			<EnvStrip />
		</div>
	)
}

export default StatusHeader
