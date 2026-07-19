import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import type { NordicModeId } from "../nordicModes"
import IntentCard from "./IntentCard"
import RunTargetToggle, { type RunTarget } from "./RunTargetToggle"
import { runIntent } from "./runIntent"
import { type IntentDef, intentDescription, type WorkspacePlatform } from "./welcomeIntents"

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

/** Persist the chosen run-target (the CraNudge localStorage pattern — a UI preference, not state). */
const TARGET_KEY = "adsum.runTarget"

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
	const { handoverUi } = useExtensionState()
	const live = intents.filter((i) => !i.comingSoon)
	const roadmap = intents.filter((i) => i.comingSoon)

	// Conductor mode (no model configured) locks the Adsum segment and pre-selects the agent.
	const conducting = !!handoverUi?.conductor.active
	const [target, setTarget] = useState<RunTarget>(() => {
		if (conducting) {
			return "agent"
		}
		try {
			return localStorage.getItem(TARGET_KEY) === "agent" ? "agent" : "adsum"
		} catch {
			return "adsum"
		}
	})
	useEffect(() => {
		if (conducting && target !== "agent") {
			setTarget("agent")
		}
	}, [conducting, target])
	const pickTarget = (t: RunTarget) => {
		setTarget(t)
		try {
			localStorage.setItem(TARGET_KEY, t)
		} catch {}
	}

	const agentMode = target === "agent"
	const anyAgentRunnable = live.some((i) => i.agentRunnable)
	const handOver = () => StateServiceClient.handoverToAgent(EmptyRequest.create({})).catch(() => {})

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
						? handOver
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
