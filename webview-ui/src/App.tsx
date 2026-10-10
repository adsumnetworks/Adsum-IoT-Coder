import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { useEffect } from "react"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import OnboardingView from "./components/onboarding/OnboardingView"
import RailView from "./components/rail/RailView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { ADSUM_VIEW } from "./config/platform.config"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showSettings,
		settingsTargetSection,
		showHistory,
		showWorktrees,
		showAnnouncement,
		onboardingModels,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideWorktrees,
		hideAnnouncement,
	} = useExtensionState()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return onboardingModels ? <OnboardingView /> : <WelcomeView />
	}

	// [0.5 sessions first] Two surfaces from one bundle. The sidebar is the rail alone: you, what to do next,
	// the hardware, the sessions, the palette, with Settings and All sessions as pages inside it. A session
	// tab is the chat alone, like Claude Code's; nothing else ever renders there.
	if (ADSUM_VIEW === "sidebar") {
		return <RailView />
	}

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{/* MCP and Account views removed */}
			{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showWorktrees}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
