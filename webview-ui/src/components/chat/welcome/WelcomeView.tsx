import React, { useState } from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import AiLimitationsFooter from "../AiLimitationsFooter"
import DemoCard from "../DemoCard"
import { DEMO_SCENARIO_LIST, hasRunDemo, ranScenarioIds } from "../demoScenarios"
import type { NordicModeId } from "../nordicModes"
import UpgradeCard from "../UpgradeCard"
import CraNudge from "./CraNudge"
import DemoPicker from "./DemoPicker"
import DockCoachMark from "./DockCoachMark"
import IntentList from "./IntentList"
import { runIntent } from "./runIntent"
import StatusHeader from "./StatusHeader"
import {
	DEEP_DEBUG_SUBLINE,
	getTenure,
	type IntentDef,
	NO_PROJECT_INTENTS,
	PROJECT_INTENTS,
	resolveIntentPlatform,
} from "./welcomeIntents"

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
	const {
		navigateToHistory,
		version,
		openFolderPaths,
		taskHistory,
		workspaceClassification,
		workspaceFeatures,
		nrfEnvironment,
		espEnvironment,
	} = useExtensionState()

	const hasWorkspace = openFolderPaths.length > 0
	const projectName = hasWorkspace ? (openFolderPaths[0].split("/").pop() ?? null) : null
	// Platform for the cards: the open project's classification wins; with no project,
	// bias by the installed toolchain (else neutral "both" so the agent asks — never
	// silently nRF). See resolveIntentPlatform.
	const platform = resolveIntentPlatform(workspaceClassification, {
		nrf: !!(nrfEnvironment?.extensionPresent || nrfEnvironment?.nrfutilPresent),
		esp: !!(espEnvironment?.extensionPresent || espEnvironment?.idfPresent),
	})

	const tenure = getTenure({
		taskCount: taskHistory?.length ?? 0,
		showAnnouncement: showUpgradeCard,
	})

	const demoDone = hasRunDemo(taskHistory)
	const ranIds = ranScenarioIds(taskHistory)
	// ≥2 registered samples → the consolidated "Try it on a sample" picker; otherwise the single hero card.
	const showPicker = DEMO_SCENARIO_LIST.length >= 2
	// Exactly ONE cyan focal point per state:
	//  - no project & no sample run yet → the sample picker IS the hero (nothing real to act on).
	//  - project open → the primary intent (Build, flash & debug) is the hero; the sample demotes to a
	//    quiet "Try another sample" below — your real project leads, not our sample (dev-as-hero).
	//  - a sample already ran → it demotes regardless.
	const heroPicker = !demoDone && !hasWorkspace

	// Grounded workspace signals (A3/A10), observed by the host probe.
	const hasBle = !!workspaceFeatures?.hasBle
	const hasWifi = !!workspaceFeatures?.hasWifi
	const hasCompliance = !!workspaceFeatures?.hasComplianceArtifacts
	// Grounded connectivity label for the CRA nudge (BLE / Wi-Fi / both) — what was detected, never a verdict.
	const craEvidence = `${hasBle && hasWifi ? "BLE & Wi-Fi" : hasWifi ? "Wi-Fi" : "BLE"} detected · no compliance artifacts in this project yet`
	// Dismissal persists per-workspace (localStorage, like DockCoachMark) so an explicitly-closed nudge stays
	// closed across a window reload — not just the session. Keyed by project so dismissing in one doesn't mute all.
	const craDismissKey = `adsum.craNudgeDismissed:${openFolderPaths[0] ?? ""}`
	const [craNudgeDismissed, setCraNudgeDismissed] = useState(() => {
		// Guarded: some webview contexts (and jsdom's opaque origin) don't expose localStorage — fall back to
		// a session-only dismiss rather than crashing the whole welcome screen.
		try {
			return typeof localStorage !== "undefined" && localStorage.getItem(craDismissKey) === "1"
		} catch {
			return false
		}
	})
	const dismissCraNudge = () => {
		try {
			localStorage?.setItem(craDismissKey, "1")
		} catch {
			// storage unavailable — session-only dismiss still works via the state update below
		}
		setCraNudgeDismissed(true)
	}
	// A3 — the grounded CRA nudge: project-open, a connectivity stack present, no SBOM yet, not dismissed.
	const craBanner = hasWorkspace && (hasBle || hasWifi) && !hasCompliance && !craNudgeDismissed
	// Precedence (one grounded promotion per paint): the A10 deep-debug sub-line is suppressed while the nudge shows.
	const showDebugSubline = hasBle && !craBanner

	// Adaptive intent set: inject the A10 sub-line on Build/flash/debug; once compliance/ exists, switch the CRA
	// card to re-run copy. The "New" pill STAYS (CRA is a new product capability — keep it flagged on all CRA
	// surfaces). No project → the no-project set, untouched.
	const intents: IntentDef[] = hasWorkspace
		? PROJECT_INTENTS.map((i) => {
				if (i.id === "buildFlashDebug" && showDebugSubline) {
					return { ...i, subline: DEEP_DEBUG_SUBLINE }
				}
				if (i.id === "craCheck" && hasCompliance) {
					return {
						...i,
						description: "Re-run on your build — refresh the SBOM & posture after changes.",
					}
				}
				return i
			})
		: NO_PROJECT_INTENTS

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

				{/* Dormant upgrade card (once per version). No separate "new user" nudge — the demo hero below is
				    the single cyan focal point for first-run, so we don't stack a duplicate same-action CTA.
				    Precedence: suppressed when the grounded CRA nudge shows (project-open → A3 owns CRA). */}
				{tenure === "dormant" && showUpgradeCard && !craBanner && (
					<UpgradeCard
						onDismiss={onUpgradeDismiss}
						onStartDemo={() => onStartDemo("cra-sample")}
						version={version ?? ""}
					/>
				)}

				{/* A3 — grounded CRA nudge (project-open). The single grounded promotion for a project-open first
				    paint: evidence-mode (what was detected, never a verdict), demotes once compliance/ exists.
				    No-reflow note: classification is synchronous on activation, so workspaceFeatures arrives
				    resolved before first paint — no uninitiated pop-in. The only mount/unmount is on a user-initiated
				    change (folder add, or a save that creates compliance/ or enables CONFIG_BT), where motion is
				    expected feedback; so we mount/unmount rather than reserve an always-empty placeholder slot. */}
				{craBanner && (
					<CraNudge
						evidence={craEvidence}
						onDismiss={dismissCraNudge}
						onPreview={() =>
							runIntent("craCheck", {
								onSelectMode,
								onStartTask,
								platform,
								projectName: projectName ?? undefined,
							})
						}
					/>
				)}

				{/* Hero sample — the single cyan focal point ONLY when there's no project to act on and no sample has
				    run yet. With a project open, the primary intent below is the hero instead. Picker when ≥2 samples
				    are registered; single hero card otherwise (graceful fallback). */}
				{heroPicker && (showPicker ? <DemoPicker onStartDemo={onStartDemo} /> : <DemoCard onStartDemo={onStartDemo} />)}

				{/* Orienting heading — ALWAYS shown; the disoriented first-timer needs the framing question most */}
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
							"New here? Start with a sample, or open your firmware."
						)}
					</div>
				</div>

				{/* Adaptive intent cards */}
				<IntentList
					hasBle={hasBle}
					intents={intents}
					onSelectMode={onSelectMode}
					onStartDemo={onStartDemo}
					onStartTask={onStartTask}
					platform={platform}
					projectName={projectName ?? undefined}
					testIdPrefix="intent-card"
				/>

				{/* Demoted sample — compact whenever it isn't the hero (project open, or already run). The heading
				    says "another" ONLY if a sample has actually run (demoDone), not just because a project is open. */}
				{!heroPicker && (
					<div className="w-full">
						{showPicker ? (
							<DemoPicker hasRunDemo={demoDone} onStartDemo={onStartDemo} ranIds={ranIds} variant="rerun" />
						) : (
							<DemoCard onStartDemo={onStartDemo} variant="rerun" />
						)}
					</div>
				)}

				{/* Dock coach mark — once, when project is open */}
				<DockCoachMark hasProject={!!hasWorkspace} />

				{/* History */}
				<div className="w-full mt-4">
					<HistoryPreview showHistoryView={navigateToHistory} />
				</div>

				{/* AI-limitations (design/13 A6) — persistent here AND under the chat input during a task (see
				    ChatView). Links to the live docs disclaimer page (docs.adsumnetworks.com/legal/limitations). */}
				<AiLimitationsFooter style={{ marginTop: "6px" }} />
			</div>
		</div>
	)
}

export default WelcomeView
