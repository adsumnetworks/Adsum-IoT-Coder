import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import type { NordicModeId } from "../nordicModes"
import { handOverCard } from "./handOverCard"
import IntentCard from "./IntentCard"
import { runIntent } from "./runIntent"
import { useRunTarget } from "./useRunTarget"
import { buildIntentPrompt, type IntentDef, intentDescription, type WorkspacePlatform } from "./welcomeIntents"

interface IntentListProps {
	intents: IntentDef[]
	onSelectMode: (mode: NordicModeId) => void
	onStartTask: (text: string) => void | Promise<void>
	/** Launch a bundled sample demo — lets the no-project CRA card run the sample instead of dead-ending. */
	onStartDemo?: (scenarioId: string) => void
	projectName?: string
	/** Detected workspace platform — drives platform-aware card copy + prompts. */
	platform?: WorkspacePlatform
	/** BLE project (CONFIG_BT=y) — drives the buildFlashDebug 3-layer observability branch. */
	hasBle?: boolean
	/** Prefix for each card's testId, e.g. "intent-card" (welcome) or "next-step" (post-task). */
	testIdPrefix: string
}

/**
 * Renders a context-aware intent-card list: live cards first, then — if the set has roadmap
 * ("coming soon") entries — an "on the roadmap" divider followed by the disabled cards.
 * Shared by the welcome screen and the post-task NextStepChooser so both stay identical.
 *
 * The run-target toggle (mockup mcp-sdk/11) decides where a card executes: this panel, or the
 * developer's own coding agent. One control, one door per card — while agent mode is on, runnable
 * cards carry a "→ your agent" route chip so the mode stays visible at the point of action.
 */
const IntentList: React.FC<IntentListProps> = ({
	intents,
	onSelectMode,
	onStartTask,
	onStartDemo,
	projectName,
	platform = "both",
	hasBle = false,
	testIdPrefix,
}) => {
	const live = intents.filter((i) => !i.comingSoon)
	// Roadmap cards are hidden from the UI (operator, 2026-07-19) — a card you cannot click earns no
	// space on a working surface. The definitions stay in welcomeIntents.ts so re-enabling is one line.
	const roadmap: IntentDef[] = []
	const { navigateToSettings } = useExtensionState()
	const { target, conducting } = useRunTarget()

	const agentMode = target === "agent"
	const anyAgentRunnable = live.some((i) => i.agentRunnable)
	// The card's own prompt travels with the handover — the mission and the workflow closure come from
	// the card the developer clicked, never from whatever session happens to be newest.
	const handOver = (intent: IntentDef) =>
		handOverCard({
			intentId: intent.id,
			platform,
			prompt: buildIntentPrompt(intent.id, projectName, platform, hasBle),
		})

	const card = (intent: IntentDef) => {
		const routesToAgent = agentMode && !!intent.agentRunnable && !intent.comingSoon
		return (
			<IntentCard
				caveat={routesToAgent ? intent.agentCaveat : undefined}
				comingSoon={intent.comingSoon}
				description={intentDescription(intent, projectName, platform)}
				icon={intent.icon}
				key={intent.id}
				onClick={
					routesToAgent
						? () => handOver(intent)
						: () => runIntent(intent.id, { onSelectMode, onStartTask, onStartDemo, projectName, platform, hasBle })
				}
				pill={intent.pill}
				primary={intent.primary}
				routeChip={routesToAgent ? "→ your agent" : undefined}
				subline={intent.subline}
				testId={`${testIdPrefix}-${intent.id}`}
				title={intent.title}
			/>
		)
	}

	return (
		<div className="flex flex-col gap-3 w-full">
			{anyAgentRunnable && target === "agent" ? (
				/* The run-target choice lives in Settings with the other providers (mcp-sdk/13); this
				   line is only the STATE, visible where the click happens, with the door to change it. */
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "6px",
						fontSize: "11px",
						color: "var(--vscode-descriptionForeground)",
						padding: "0 2px",
					}}>
					<span>
						⇄ Cards run on <strong style={{ color: "var(--vscode-foreground)" }}>your coding agent</strong>
						{conducting ? " — no model configured, Adsum is conducting" : ""} ·
					</span>
					<button
						onClick={() => navigateToSettings("api-config")}
						style={{
							background: "none",
							border: "none",
							padding: 0,
							cursor: "pointer",
							fontSize: "11px",
							color: "var(--vscode-textLink-foreground)",
							textDecoration: "underline",
						}}
						type="button">
						change
					</button>
				</div>
			) : null}
			{live.map(card)}
			{roadmap.length > 0 && (
				<>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "10px",
							margin: "4px 2px",
							color: "var(--vscode-descriptionForeground)",
							fontSize: "10px",
							letterSpacing: "0.06em",
							textTransform: "uppercase",
						}}>
						<span style={{ flex: 1, height: "1px", background: "var(--vscode-widget-border)" }} />
						on the roadmap
						<span style={{ flex: 1, height: "1px", background: "var(--vscode-widget-border)" }} />
					</div>
					{roadmap.map(card)}
				</>
			)}
		</div>
	)
}

export default IntentList
