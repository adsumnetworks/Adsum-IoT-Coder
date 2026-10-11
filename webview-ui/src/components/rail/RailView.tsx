import type { AdsumAccountState } from "@shared/adsumAccount"
import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"
import WhatsNewCard from "../chat/WhatsNewCard"
import { paletteOpen as countPaletteOpen, entryRunStart, gateShown, suggestionClick } from "../chat/welcome/entryTelemetry"
import GatePanel from "../chat/welcome/GatePanel"
import RequestAccessForm from "../chat/welcome/RequestAccessForm"
import { isRequestOnlyGroup, requestFamilyFor } from "../chat/welcome/welcomeIntents"
import { AdsumLogo, AdsumMark } from "../common/AdsumLogo"
import Info from "../common/Info"
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
const MIGRATED_KEY = "adsum.rail.migrated"

/** One notice slot, one look: coral for the product's own news, the warning tone for a state to act on. */
const noticeStyle = (tone: "coral" | "warn"): React.CSSProperties => ({
	...R.meta,
	border: `1px solid color-mix(in srgb, ${tone === "coral" ? R.coral : R.warn} 45%, transparent)`,
	background: `color-mix(in srgb, ${tone === "coral" ? R.coral : R.warn} 5%, transparent)`,
	borderRadius: 6,
	padding: "6px 8px",
	display: "flex",
	justifyContent: "space-between",
	gap: 8,
})
/** The 0.4 cockpit's own browser-state keys; nothing reads them once the rail is the sidebar. */
const RETIRED_KEYS = ["adsum.entry.seenRuns", "adsum.env.alwaysOpen", "adsum.dockCoachMarkDismissed"]

/** [0.5 sessions first] One-time cleanup of the cockpit's keys on the rail's first mount; idempotent. */
export function migrateCockpitState(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage): boolean {
	try {
		if (storage.getItem(MIGRATED_KEY) === "1") {
			return false
		}
		for (const k of RETIRED_KEYS) {
			storage.removeItem(k)
		}
		storage.setItem(MIGRATED_KEY, "1")
		return true
	} catch {
		return false
	}
}

/**
 * [0.5 sessions first] The sidebar is the rail alone: You, the notice slot, Environment, Suggested, Sessions,
 * the palette row. Settings, All sessions and the Hardware page are pages inside it. A session is never
 * rendered here: every card click asks the host for an editor tab, with its prompt shown there.
 */
interface RailViewProps {
	/** Stories and tests start on a page or with the palette open; the product always starts home. */
	initialPage?: Page
	initialPalette?: boolean
}

const RailView: React.FC<RailViewProps> = ({ initialPage = "home", initialPalette = false }) => {
	const {
		adsumAccount,
		showSettings,
		settingsTargetSection,
		hideSettings,
		showHistory,
		hideHistory,
		navigateToSettings,
		navigateToHistory,
		taskHistory,
		quota,
		hostOffline,
	} = useExtensionState() as ReturnType<typeof useExtensionState> & { adsumAccount?: AdsumAccountState }
	const [page, setPage] = useState<Page>(initialPage)
	/** The family a row asked the Hardware page for; the Environment block opens it on the desk's own. */
	const [hardwareFamily, setHardwareFamily] = useState<string | undefined>(undefined)
	const [paletteOpen, setPaletteOpen] = useState(initialPalette)
	const [gateOpen, setGateOpen] = useState(false)
	const [requesting, setRequesting] = useState<string | null>(null)
	const { all, suggested } = useRankedRuns()
	const rootRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		migrateCockpitState()
	}, [])

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
				countPaletteOpen("keyboard")
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
		if (run.hardwareFamily) {
			// The demo images are downloaded on the Hardware page, with their licence, and flashed from there.
			entryRunStart(run.id, via)
			setHardwareFamily(run.hardwareFamily)
			setPage("hardware")
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
					// A session is a tab: the sidebar's own chat is never shown, so loading it there shows nothing.
					// The page stays as it is, the way the rail's own rows leave the rail where it was.
					onOpen={(item) => void openSession({ taskId: item.id })}
				/>
			</div>
		)
	}

	return (
		<div
			ref={rootRef}
			style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 12, minHeight: "100vh" }}>
			{/* Rows light up under the pointer, the way a list does; inline styles cannot say :hover. */}
			<style>{`.rail-row:hover{background:color-mix(in srgb, var(--vscode-foreground) 7%, transparent)}.rail-row:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}`}</style>
			{page === "hardware" ? (
				<HardwarePage
					family={hardwareFamily}
					onAsk={(family) => setRequesting(family)}
					onBack={() => setPage("home")}
					onPrompt={(prompt, options) => void openSession({ prompt, ...options })}
					onRegister={() => setGateOpen(true)}
				/>
			) : (
				<>
					{/* The lockup, first: the mark in coral and the name in type, the same on every surface. */}
					<div data-testid="rail-lockup" style={{ display: "flex", alignItems: "center", padding: "4px 0 2px" }}>
						<AdsumLogo size={26} />
					</div>
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
					{hostOffline ? (
						<div aria-live="polite" role="status" style={noticeStyle("warn")}>
							<span style={{ display: "flex", alignItems: "center", gap: 6 }}>
								<b style={{ color: "var(--vscode-foreground)" }}>Offline.</b> Local tools and loaded knowledge
								still work
								<Info text="The model and the registry are not reachable. Your files, the device tools and the knowledge already loaded in a session keep working; a new session waits for the connection." />
							</span>
						</div>
					) : quota?.kind === "spent" ? (
						<div aria-live="polite" role="status" style={noticeStyle("warn")}>
							<span style={{ display: "flex", alignItems: "center", gap: 6 }}>
								<b style={{ color: "var(--vscode-foreground)" }}>Free tier spent.</b>
								<button
									onClick={() => {
										navigateToSettings("api-config")
										setPage("settings")
									}}
									style={R.link}
									type="button">
									Add a key
								</button>
								<Info text="The free allowance is used up for now; it comes back on its own. A key of your own, any provider, keeps you going without waiting." />
							</span>
						</div>
					) : null}
					{/* The card draws its own coral frame: dismissed, it renders nothing and the frame goes with it. */}
					{!hostOffline && quota?.kind !== "spent" && (taskHistory?.length ?? 0) > 0 && <WhatsNewCard framed />}
					<section aria-label="Environment">
						<RailHardware
							onOpen={() => {
								setHardwareFamily(undefined)
								setPage("hardware")
							}}
						/>
					</section>
					<section aria-label="Suggested">
						<RailSuggested
							onLocked={lockedRow}
							onRun={(r) => {
								suggestionClick(
									r.id,
									suggested.some((s) => s.item.id === r.id && s.grounded),
								)
								void runRow(r, "card")
							}}
							rows={suggested}
						/>
					</section>
					<section aria-label="Sessions">
						<RailSessions
							onAll={() => navigateToHistory()}
							onNew={() => void openSession({})}
							onOpen={openHistoryItem}
						/>
					</section>
					<button
						onClick={() => {
							countPaletteOpen("rail")
							setPaletteOpen(true)
						}}
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
						<span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
							<AdsumMark size={13} />
							What can you ask
						</span>
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
