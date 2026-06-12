import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import DemoCard from "../DemoCard"
import type { NordicModeId } from "../nordicModes"
import IntentList from "./IntentList"
import { NO_PROJECT_INTENTS, PROJECT_INTENTS } from "./welcomeIntents"

interface NextStepChooserProps {
	isDemoRun: boolean
	onSelectMode: (mode: NordicModeId) => void
	onStartTask: (text: string) => void | Promise<void>
	onStartDemo: (scenarioId: string) => void
}

const NextStepChooser: React.FC<NextStepChooserProps> = ({ isDemoRun, onSelectMode, onStartTask, onStartDemo }) => {
	const { openFolderPaths, workspaceClassification } = useExtensionState()
	const hasWorkspace = openFolderPaths.length > 0
	const projectName = hasWorkspace ? (openFolderPaths[0].split("/").pop() ?? undefined) : undefined
	const intents = hasWorkspace ? PROJECT_INTENTS : NO_PROJECT_INTENTS
	const platform = workspaceClassification && workspaceClassification !== "none" ? workspaceClassification : "nrf"
	const heading = isDemoRun ? "Your turn — pick a next step…" : "What would you like to do next?"

	return (
		<div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
			<div
				style={{
					fontSize: "13px",
					fontWeight: 600,
					color: "var(--vscode-descriptionForeground)",
					marginBottom: "2px",
				}}>
				{heading}
			</div>

			<IntentList
				intents={intents}
				onSelectMode={onSelectMode}
				onStartTask={onStartTask}
				platform={platform}
				projectName={projectName}
				testIdPrefix="next-step"
			/>

			{isDemoRun && <DemoCard onStartDemo={onStartDemo} variant="rerun" />}
		</div>
	)
}

export default NextStepChooser
