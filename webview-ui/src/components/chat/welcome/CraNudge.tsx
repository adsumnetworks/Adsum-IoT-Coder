import React from "react"
import { BRAND_CORAL, BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha, brandSubtle } from "../brandColors"

interface CraNudgeProps {
	/** Grounded evidence line — what was detected, NEVER a verdict (e.g. "BLE detected · no SBOM in this project yet"). */
	evidence: string
	onPreview: () => void
	onDismiss: () => void
}

/**
 * A3 — grounded CRA nudge (project-open). Renders ONLY on real evidence (a connectivity stack present AND no
 * `compliance/` artifacts yet); the host gates that. Demotes once an SBOM exists. Evidence-mode by doctrine:
 * it states what was detected and hedges the legal framing ("likely … confirm your class") — it never asserts
 * a conformity verdict. The single grounded promotion for a project-open first paint (it suppresses What's-New).
 */
const CraNudge: React.FC<CraNudgeProps> = ({ evidence, onPreview, onDismiss }) => {
	return (
		<div
			data-testid="cra-nudge"
			style={{
				width: "100%",
				position: "relative",
				display: "flex",
				gap: "12px",
				padding: "12px 14px",
				background: brandSubtle(BRAND_CORAL, 8),
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.5)}`,
				borderRadius: "10px",
			}}>
			<button
				aria-label="Dismiss"
				data-testid="cra-nudge-dismiss"
				onClick={onDismiss}
				style={{
					position: "absolute",
					top: "6px",
					right: "8px",
					background: "transparent",
					border: "none",
					color: "var(--vscode-descriptionForeground)",
					cursor: "pointer",
					fontSize: "12px",
					lineHeight: 1,
					padding: "2px",
				}}
				type="button">
				<i className="codicon codicon-close" />
			</button>

			<div
				style={{
					flexShrink: 0,
					width: "28px",
					height: "28px",
					borderRadius: "50%",
					background: BRAND_CYAN_700,
					color: "#fff",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}>
				<i className="codicon codicon-shield" style={{ fontSize: "15px" }} />
			</div>

			<div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
				<div style={{ fontSize: "13px", fontWeight: 700, color: "var(--vscode-foreground)" }}>Get ahead of the CRA</div>
				<div
					style={{
						fontSize: "11px",
						color: "var(--vscode-descriptionForeground)",
						marginTop: "2px",
						fontWeight: 600,
					}}>
					{evidence}
				</div>
				<div
					style={{
						fontSize: "11.5px",
						color: "var(--vscode-descriptionForeground)",
						marginTop: "6px",
						lineHeight: 1.45,
					}}>
					A connected product likely falls under the EU Cyber Resilience Act (confirm your class). Preview your
					secure-by-design posture from your real build.{" "}
					<button
						data-testid="cra-nudge-preview"
						onClick={onPreview}
						style={{
							background: "transparent",
							border: "none",
							padding: 0,
							color: BRAND_CYAN_600,
							fontWeight: 700,
							cursor: "pointer",
							fontSize: "11.5px",
						}}
						type="button">
						Preview →
					</button>
				</div>
			</div>
		</div>
	)
}

export default CraNudge
