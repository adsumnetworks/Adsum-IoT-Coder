import React from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import DemoCard from "../DemoCard"
import { DEFAULT_DEMO_SCENARIO_ID, hasRunDemo } from "../demoScenarios"
import type { NordicModeId } from "../nordicModes"
import UpgradeCard from "../UpgradeCard"
import DockCoachMark from "./DockCoachMark"
import IntentList from "./IntentList"
import StatusHeader from "./StatusHeader"
import TenureNudge from "./TenureNudge"
import { getTenure, NO_PROJECT_INTENTS, PROJECT_INTENTS } from "./welcomeIntents"

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
	const { navigateToHistory, version, openFolderPaths, taskHistory } = useExtensionState()

	const hasWorkspace = openFolderPaths.length > 0
	const projectName = hasWorkspace ? (openFolderPaths[0].split("/").pop() ?? null) : null

	const tenure = getTenure({
		taskCount: taskHistory?.length ?? 0,
		showAnnouncement: showUpgradeCard,
	})

	const intents = hasWorkspace ? PROJECT_INTENTS : NO_PROJECT_INTENTS
	// Once the demo has run at least once, it stops being the hero — intents lead, demo demotes to a
	// quiet "Re-run demo" at the bottom. First-run users still get the prominent cyan hero.
	const demoDone = hasRunDemo(taskHistory)

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

				{/* Hero demo — the bulletproof floor, until the user has run it once */}
				{!demoDone && <DemoCard onStartDemo={onStartDemo} />}

				{/* "What would you like to do?" — only when a project is open (the chooser context) */}
				{hasWorkspace && (
					<div className="w-full">
						<div style={{ fontSize: "13px", fontWeight: 700, color: "var(--vscode-foreground)" }}>
							What would you like to do?
						</div>
						<div style={{ fontSize: "11.5px", color: "var(--vscode-descriptionForeground)", marginTop: "2px" }}>
							{projectName ? (
								<>
									Working on <b>{projectName}</b> — pick a step.
								</>
							) : (
								"Pick a step."
							)}
						</div>
					</div>
				)}

				{/* Adaptive intent cards */}
				<IntentList
					intents={intents}
					onSelectMode={onSelectMode}
					onStartTask={onStartTask}
					projectName={projectName ?? undefined}
					testIdPrefix="intent-card"
				/>

				{/* Demoted demo — quiet "Re-run demo" once it has been seen */}
				{demoDone && (
					<div className="w-full">
						<DemoCard onStartDemo={onStartDemo} variant="rerun" />
					</div>
				)}

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
