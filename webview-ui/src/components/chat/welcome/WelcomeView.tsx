import React from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import DemoCard from "../DemoCard"
import { DEFAULT_DEMO_SCENARIO_ID } from "../demoScenarios"
import type { NordicModeId } from "../nordicModes"
import UpgradeCard from "../UpgradeCard"
import DockCoachMark from "./DockCoachMark"
import IntentCard from "./IntentCard"
import StatusHeader from "./StatusHeader"
import TenureNudge from "./TenureNudge"
import { buildIntentPrompt, getTenure, NO_PROJECT_INTENTS, PROJECT_INTENTS } from "./welcomeIntents"

interface WelcomeViewProps {
	onSelectMode: (mode: NordicModeId) => void
	onStartTask: (text: string) => Promise<void>
	onStartDemo: (scenarioId: string) => void
	onUpgradeDismiss: () => void
	showUpgradeCard: boolean
}

const WelcomeView: React.FC<WelcomeViewProps> = ({
	onSelectMode,
	onStartTask,
	onStartDemo,
	onUpgradeDismiss,
	showUpgradeCard,
}) => {
	const { isDark } = useVSCodeTheme()
	const { navigateToHistory, version, workspaceRoots, taskHistory } = useExtensionState()

	const hasWorkspace = workspaceRoots && workspaceRoots.length > 0
	const projectName = hasWorkspace ? (workspaceRoots[0].name ?? workspaceRoots[0].path.split("/").pop() ?? null) : null

	const tenure = getTenure({
		taskCount: taskHistory?.length ?? 0,
		showAnnouncement: showUpgradeCard,
	})

	const intents = hasWorkspace ? PROJECT_INTENTS : NO_PROJECT_INTENTS

	const handleIntentClick = (id: string) => {
		if (id === "debug") {
			onSelectMode("log_analyzer")
		} else {
			void onStartTask(buildIntentPrompt(id as Parameters<typeof buildIntentPrompt>[0], projectName ?? undefined))
		}
	}

	return (
		<div
			className="flex flex-col items-center flex-1 px-5 pt-6 pb-4"
			data-testid="welcome-view"
			style={{ overflowY: "auto" }}>
			{/* Logo */}
			<div className="flex justify-center w-full py-4">
				<img
					alt="Adsum IoT Coder"
					src={isDark ? adsumLogoDark : adsumLogoLight}
					style={{ maxWidth: "180px", width: "100%" }}
				/>
			</div>

			<div className="flex flex-col items-center gap-4 w-full flex-1 justify-center" style={{ maxWidth: "360px" }}>
				{/* StatusHeader: project strip + EnvStrip seam */}
				<StatusHeader projectName={projectName} />

				{/* Tenure-gated nudge */}
				{tenure === "new" && <TenureNudge onStartDemo={() => onStartDemo(DEFAULT_DEMO_SCENARIO_ID)} />}
				{tenure === "dormant" && showUpgradeCard && (
					<UpgradeCard
						onDismiss={onUpgradeDismiss}
						onStartDemo={() => onStartDemo(DEFAULT_DEMO_SCENARIO_ID)}
						version={version ?? ""}
					/>
				)}

				{/* Hero demo — always the bulletproof floor */}
				<DemoCard onStartDemo={onStartDemo} />

				{/* Adaptive intent cards */}
				<div className="flex flex-col gap-3 w-full">
					{intents.map((intent) => (
						<IntentCard
							description={
								intent.id === "addFeature" && projectName
									? `Add a Zephyr shell, BLE service, or NVS to ${projectName} — I'll wire it into your build.`
									: intent.description
							}
							icon={intent.icon}
							key={intent.id}
							onClick={() => handleIntentClick(intent.id)}
							primary={intent.primary}
							testId={`intent-card-${intent.id}`}
							title={intent.title}
						/>
					))}
				</div>

				{/* Dock coach mark — once, when project is open */}
				<DockCoachMark hasProject={!!hasWorkspace} />

				{/* History */}
				<div className="w-full mt-4">
					<HistoryPreview showHistoryView={navigateToHistory} />
				</div>
			</div>
		</div>
	)
}

export default WelcomeView
