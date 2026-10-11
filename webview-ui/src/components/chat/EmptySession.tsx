import type { AdsumAccountState } from "@shared/adsumAccount"
import { StringRequest } from "@shared/proto/cline/common"
import type React from "react"
import { useEffect, useState } from "react"
import { AdsumMark } from "@/components/common/AdsumLogo"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"
import Palette from "../rail/Palette"
import { R } from "../rail/railStyles"
import { type Run, useRankedRuns } from "../rail/useRankedRuns"
import FirstSteps from "./FirstSteps"
import WhatsNewCard from "./WhatsNewCard"
import { paletteOpen as countPaletteOpen, entryRunStart, gateShown } from "./welcome/entryTelemetry"
import GatePanel from "./welcome/GatePanel"
import RequestAccessForm from "./welcome/RequestAccessForm"
import { useEntrySignals } from "./welcome/useEntrySignals"
import { isRequestOnlyGroup, requestFamilyFor } from "./welcome/welcomeIntents"

const T = {
	label: {
		fontSize: 10,
		letterSpacing: ".08em",
		textTransform: "uppercase" as const,
		color: "var(--vscode-descriptionForeground)",
	},
	body: { fontSize: 12.5, lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" },
}

/** The two prefill prompts First steps shares with the EmptySession rows it replaced — same text,
 *  same contract: Enter sends it, never fired on click. */
const BUILD_PROMPT =
	"Build, flash and debug this project: build it, flash the connected board, then stream the live logs and watch for faults."
const GATEWAY_PROMPT =
	"Start the BLG20x first run: the plan and the parts to have on the desk, identify the board from its probes, flash the prebuilt pair, commission it, and bring the first reading to my tenant."
const SAMPLE_PROMPT = "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]"

/**
 * [0.5 sessions first] What a new session tab shows before its first message. The cards live in the
 * sidebar's palette; here, while `entryMode()` says the developer is new to this folder (fewer than two
 * sessions, none in 30 days, or none here), the First steps ladder and the What's new card sit under the
 * "Say what you want done" line. After that the placeholder stands alone.
 *
 * The two lines sit in the middle of the tab, centred under the mark, the way a conversation page opens:
 * the lockup stays at the top as the product's name, the mark here is the empty state's one glyph.
 */
const EmptySession: React.FC<{ onStartTask: (text: string) => void | Promise<void>; onPrefill: (text: string) => void }> = ({
	onStartTask,
	onPrefill,
}) => {
	const { mode, scopeName, roots } = useEntrySignals()
	const { taskHistory, adsumAccount } = useExtensionState() as ReturnType<typeof useExtensionState> & {
		adsumAccount?: AdsumAccountState
	}
	const expanded = mode.mode === "expanded"
	const [registerOpen, setRegisterOpen] = useState(false)
	// [11 Oct 2026] What can you ask, in the tab itself: the rail's palette under the two lines, so the developer
	// picks a run, a journey, a check or a sample where they are about to type. A row runs in THIS tab: ▶ sends,
	// ✎ fills the box; a locked row opens the gate or the request form, as in the rail. ⌘K opens it here too.
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [requesting, setRequesting] = useState<string | null>(null)
	const { all, suggested } = useRankedRuns()
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault()
				countPaletteOpen("composer")
				setPaletteOpen(true)
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])
	const runRow = (run: Run) => {
		setPaletteOpen(false)
		if (run.kind === "open-folder") {
			void FileServiceClient.openFolder(StringRequest.create({ value: "" }))
			return
		}
		if (!run.prompt) {
			return
		}
		entryRunStart(run.id, run.kind === "sample" ? "sample" : "drawer")
		if (run.kind === "fire" || run.kind === "sample") {
			void onStartTask(run.prompt)
		} else {
			onPrefill(run.prompt)
		}
	}
	const lockedRow = (run: Run) => {
		setPaletteOpen(false)
		if (!adsumAccount) {
			gateShown("first-steps", run.id)
			setRegisterOpen(true)
			return
		}
		if (isRequestOnlyGroup(run.entitlement)) {
			setRequesting(requestFamilyFor(run.entitlement))
		}
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: "12px 14px",
				marginTop: "auto",
				marginBottom: "auto",
			}}>
			<div
				data-testid="empty-session-hero"
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					textAlign: "center",
					gap: 6,
					marginBottom: expanded ? 10 : 0,
				}}>
				<span style={{ marginBottom: 6, lineHeight: 0 }}>
					<AdsumMark size={36} />
				</span>
				<div style={T.label}>{scopeName ? `New session · ${scopeName}` : "New session"}</div>
				<div style={T.body}>Say what you want done, then Enter.</div>
				<button
					data-testid="empty-session-palette"
					onClick={() => {
						countPaletteOpen("composer")
						setPaletteOpen(true)
					}}
					style={{
						marginTop: 10,
						display: "inline-flex",
						alignItems: "center",
						gap: 7,
						padding: "6px 10px",
						borderRadius: 6,
						border: "1px solid color-mix(in srgb, var(--vscode-foreground) 22%, transparent)",
						background: "none",
						color: "var(--vscode-foreground)",
						font: "inherit",
						cursor: "pointer",
					}}
					type="button">
					<AdsumMark size={13} />
					What can you ask
					<span style={R.pf}>⌘K</span>
				</button>
			</div>
			{expanded && (
				<FirstSteps
					onOpenProject={() => void FileServiceClient.openFolder(StringRequest.create({ value: "" }))}
					onPrefillBuild={() => onPrefill(BUILD_PROMPT)}
					onPrefillGateway={() => onPrefill(GATEWAY_PROMPT)}
					onRegister={() => setRegisterOpen(true)}
					onRunSample={() => void onStartTask(SAMPLE_PROMPT)}
					state={{ adsumAccount, openFolderPaths: roots, taskHistory }}
				/>
			)}
			<WhatsNewCard />
			<GatePanel onClose={() => setRegisterOpen(false)} open={registerOpen} surface="first-steps" />
			<Palette
				onClose={() => setPaletteOpen(false)}
				onLocked={lockedRow}
				onRun={runRow}
				open={paletteOpen}
				runs={all}
				suggested={suggested}
			/>
			<RequestAccessForm family={requesting ?? undefined} onClose={() => setRequesting(null)} open={!!requesting} />
		</div>
	)
}

export default EmptySession
