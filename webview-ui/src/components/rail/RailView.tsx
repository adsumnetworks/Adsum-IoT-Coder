import type { AdsumAccountState } from "@shared/adsumAccount"
import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"
import { entryRunStart, gateShown } from "../chat/welcome/entryTelemetry"
import GatePanel from "../chat/welcome/GatePanel"
import RequestAccessForm from "../chat/welcome/RequestAccessForm"
import { isRequestOnlyGroup, requestFamilyFor } from "../chat/welcome/welcomeIntents"
import HistoryView from "../history/HistoryView"
import SettingsView from "../settings/SettingsView"
import HardwarePage from "./HardwarePage"
import { openSession } from "./openSession"
import Palette from "./Palette"
import RailHardware from "./RailHardware"
import RailSessions from "./RailSessions"
import RailSuggested from "./RailSuggested"
import RailYou from "./RailYou"
import { R } from "./railStyles"
import { type Run, useRankedRuns } from "./useRankedRuns"

type Page = "home" | "settings" | "sessions" | "hardware"
const MOVED_KEY = "adsum.rail.cardsMovedSeen"

/**
 * [0.5 sessions first] The sidebar is the rail alone: You, the notice slot, Suggested, Hardware, Sessions,
 * the palette row. Settings, All sessions and the Hardware page are pages inside it. A session is never
 * rendered here: every card click asks the host for an editor tab, with its prompt shown there.
 */
const RailView: React.FC = () => {
	const {
		adsumAccount,
		showSettings,
		settingsTargetSection,
		hideSettings,
		showHistory,
		hideHistory,
		navigateToSettings,
		navigateToHistory,
	} = useExtensionState() as ReturnType<typeof useExtensionState> & { adsumAccount?: AdsumAccountState }
	const [page, setPage] = useState<Page>("home")
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [gateOpen, setGateOpen] = useState(false)
	const [requesting, setRequesting] = useState<string | null>(null)
	const [movedSeen, setMovedSeen] = useState(() => {
		try {
			return localStorage.getItem(MOVED_KEY) === "1"
		} catch {
			return true
		}
	})
	const { all, suggested } = useRankedRuns()
	const rootRef = useRef<HTMLDivElement>(null)

	// The title-bar buttons (⚙, ↺) still talk to the sidebar: they open its pages now.
	useEffect(() => {
		if (showSettings) {
			setPage("settings")
		}
	}, [showSettings])
	useEffect(() => {
		if (showHistory) {
			setPage("sessions")
		}
	}, [showHistory])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault()
				setPaletteOpen(true)
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])

	const runRow = useCallback(async (run: Run, via: "card" | "drawer" | "sample" = "card") => {
		setPaletteOpen(false)
		if (run.kind === "open-folder") {
			void FileServiceClient.openFolder(StringRequest.create({ value: "" }))
			return
		}
		entryRunStart(run.id, run.kind === "sample" ? "sample" : via)
		const send = run.kind === "fire" || run.kind === "sample"
		await openSession({ prompt: run.prompt, send, title: run.title })
	}, [])

	const lockedRow = useCallback(
		(run: Run) => {
			setPaletteOpen(false)
			if (!adsumAccount) {
				gateShown("rail", run.id)
				setGateOpen(true)
				return
			}
			if (isRequestOnlyGroup(run.entitlement)) {
				setRequesting(requestFamilyFor(run.entitlement))
				return
			}
			setGateOpen(true)
		},
		[adsumAccount],
	)

	const openHistoryItem = useCallback((item: HistoryItem) => {
		if (item.handoverId) {
			// A session worked by an external agent has no transcript of its own: All sessions knows how to show it.
			setPage("sessions")
			return
		}
		void openSession({ taskId: item.id })
	}, [])

	const dismissMoved = () => {
		setMovedSeen(true)
		try {
			localStorage.setItem(MOVED_KEY, "1")
		} catch {
			// private window
		}
	}

	if (page === "settings") {
		return (
			<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
				<SettingsView
					onDone={() => {
						hideSettings()
						setPage("home")
					}}
					targetSection={settingsTargetSection}
				/>
			</div>
		)
	}
	if (page === "sessions") {
		return (
			<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
				<HistoryView
					onDone={() => {
						hideHistory()
						setPage("home")
					}}
				/>
			</div>
		)
	}

	return (
		<div
			ref={rootRef}
			style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 12, minHeight: "100vh" }}>
			{page === "hardware" ? (
				<HardwarePage
					onAsk={(family) => setRequesting(family)}
					onBack={() => setPage("home")}
					onPrompt={(prompt, send) => void openSession({ prompt, send })}
				/>
			) : (
				<>
					<RailYou
						onAccount={() => {
							navigateToSettings("account")
							setPage("settings")
						}}
						onProvider={() => {
							navigateToSettings("api-config")
							setPage("settings")
						}}
						onSignIn={() => setGateOpen(true)}
					/>
					{!movedSeen && (
						<div
							style={{
								...R.meta,
								border: `1px solid color-mix(in srgb, ${R.coral} 45%, transparent)`,
								background: `color-mix(in srgb, ${R.coral} 5%, transparent)`,
								borderRadius: 6,
								padding: "6px 8px",
								display: "flex",
								justifyContent: "space-between",
								gap: 8,
							}}>
							<span>
								<b style={{ color: "var(--vscode-foreground)" }}>Cards moved.</b> Everything the cards did is in
								What can you ask; the relevant ones come first. A session now opens as a tab beside your code.
							</span>
							<button
								aria-label="Dismiss"
								onClick={dismissMoved}
								style={{
									background: "none",
									border: 0,
									color: "var(--vscode-descriptionForeground)",
									cursor: "pointer",
									fontSize: 13,
									lineHeight: 1,
									padding: 0,
								}}
								type="button">
								×
							</button>
						</div>
					)}
					<RailSuggested onLocked={lockedRow} onRun={(r) => void runRow(r, "card")} rows={suggested} />
					<RailHardware onOpen={() => setPage("hardware")} />
					<RailSessions onAll={() => navigateToHistory()} onNew={() => void openSession({})} onOpen={openHistoryItem} />
					<button
						onClick={() => setPaletteOpen(true)}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 8,
							fontSize: 12,
							padding: "6px 8px",
							borderRadius: 6,
							border: "1px solid color-mix(in srgb, var(--vscode-foreground) 22%, transparent)",
							background: "none",
							color: "var(--vscode-foreground)",
							font: "inherit",
							cursor: "pointer",
							width: "100%",
						}}
						type="button">
						<span>What can you ask</span>
						<span style={R.pf}>⌘K</span>
					</button>
				</>
			)}
			<Palette
				onClose={() => setPaletteOpen(false)}
				onLocked={lockedRow}
				onRun={(r) => void runRow(r, "drawer")}
				open={paletteOpen}
				runs={all}
				suggested={suggested}
			/>
			<GatePanel onClose={() => setGateOpen(false)} open={gateOpen} surface="rail" />
			<RequestAccessForm family={requesting ?? undefined} onClose={() => setRequesting(null)} open={!!requesting} />
		</div>
	)
}

export default RailView
