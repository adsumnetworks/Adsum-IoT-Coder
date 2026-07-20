import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha } from "../brandColors"
import { buildTurns } from "./turns"

/**
 * The agent's session, rendered as the FIRST PART of the conversation you are now continuing.
 *
 * When a handed-over session comes back, the work it did is the history of the thread the developer is
 * about to continue — not a separate document to go and find. Opening a markdown file to see "what the
 * agent did" breaks the continuity that made the handover worth doing. So the turns live here, inline,
 * above the resumed task: collapsed to one line by default, expanded in place.
 *
 * It belongs to ONE task: the one that resumed the session. This used to be bounded only by a 12h clock
 * on a globally-held strip, so every task opened in that window — including brand-new, unrelated ones —
 * was told "Earlier in this session" about work it had nothing to do with. Identity, not recency, decides:
 * no recorded pairing ⇒ nothing renders, because we cannot show it is the same thread.
 */
const AgentSessionRecap: React.FC = () => {
	const { handoverUi, currentTaskItem } = useExtensionState()
	const [open, setOpen] = useState(false)
	const strip = handoverUi?.strip
	if (!strip?.returned || !strip.resumedTaskId || strip.resumedTaskId !== currentTaskItem?.id) {
		return null
	}
	const turns = buildTurns(strip)
	const agentTurns = turns.filter((t) => t.speaker === "agent")
	const authors = [...new Set(strip.closing?.standingOn.authors ?? [])]

	return (
		<div
			style={{
				margin: "10px 12px 0",
				border: "1px solid var(--vscode-panel-border)",
				borderRadius: "8px",
				background: brandAlpha(BRAND_CYAN_600, 0.05),
				overflow: "hidden",
			}}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					width: "100%",
					padding: "7px 11px",
					background: "none",
					border: "none",
					cursor: "pointer",
					textAlign: "left",
					fontSize: "11.5px",
					color: "var(--vscode-descriptionForeground)",
				}}
				type="button">
				<span style={{ color: BRAND_CYAN_700 }}>⇄</span>
				<span style={{ flex: 1, minWidth: 0 }}>
					<strong style={{ color: "var(--vscode-foreground)" }}>Earlier in this session</strong> — your coding agent
					worked {agentTurns.length} milestone{agentTurns.length === 1 ? "" : "s"}
					{strip.closing?.adsumSaw.diffstat ? ` · ${strip.closing.adsumSaw.diffstat}` : ""}
				</span>
				<span>{open ? "hide ▾" : "show ▸"}</span>
			</button>
			{open ? (
				<div
					style={{
						borderTop: "1px solid var(--vscode-panel-border)",
						padding: "10px 12px",
						display: "flex",
						flexDirection: "column",
						gap: "9px",
						maxHeight: "40vh",
						overflowY: "auto",
					}}>
					{agentTurns.map((t, i) => (
						<div key={`${t.at}-${i}`}>
							<div style={{ fontSize: "10px", color: "var(--vscode-descriptionForeground)", fontWeight: 700 }}>
								◇ your agent
								{"step" in t && t.step ? ` · ${t.step}` : ""}
							</div>
							{"text" in t && t.text ? (
								<div style={{ fontSize: "12.5px", lineHeight: 1.5, color: "var(--vscode-foreground)" }}>
									{t.text}
								</div>
							) : null}
						</div>
					))}
					{strip.closing ? (
						<div style={{ fontSize: "11.5px", color: "var(--vscode-descriptionForeground)", lineHeight: 1.5 }}>
							<strong style={{ color: "var(--vscode-foreground)" }}>Closed:</strong> {strip.closing.headline}
							{strip.closing.itSays.nextStep ? ` · next: ${strip.closing.itSays.nextStep}` : ""}
						</div>
					) : null}
					{authors.length ? (
						<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
							<span style={{ color: BRAND_CORAL }}>◆</span> standing on knowledge by{" "}
							<span style={{ color: BRAND_CORAL }}>{authors.join(", ")}</span>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	)
}

export default AgentSessionRecap
