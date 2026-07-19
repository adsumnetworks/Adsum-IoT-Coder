import { StringRequest } from "@shared/proto/cline/common"
import React from "react"
import { StateServiceClient } from "@/services/grpc-client"
import type { NordicModeId } from "../nordicModes"
import IntentCard from "./IntentCard"
import RunTargetToggle from "./RunTargetToggle"
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
	const roadmap = intents.filter((i) => i.comingSoon)
	const { target, conducting, setTarget: pickTarget } = useRunTarget()

	const agentMode = target === "agent"
	const anyAgentRunnable = live.some((i) => i.agentRunnable)
	// The card's own prompt travels with the handover — the mission and the workflow closure come from
	// the card the developer clicked, never from whatever session happens to be newest.
	const handOver = (intent: IntentDef) =>
		StateServiceClient.handoverToAgent(
			StringRequest.create({
				value: JSON.stringify({
					intentId: intent.id,
					platform,
					prompt: buildIntentPrompt(intent.id, projectName, platform, hasBle),
				}),
			}),
		).catch(() => {})

	const card = (intent: IntentDef) => {
		const routesToAgent = agentMode && !!intent.agentRunnable && !intent.comingSoon
		return (
			<IntentCard
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
			{anyAgentRunnable ? <RunTargetToggle conducting={conducting} onChange={pickTarget} target={target} /> : null}
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
