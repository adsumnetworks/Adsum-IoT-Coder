import { ADSUM_REGISTERED_BANNER, type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useMemo, useState } from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, StateServiceClient, TaskServiceClient, WebServiceClient } from "@/services/grpc-client"
import { BRAND_CORAL, BRAND_CYAN_TEXT, BRAND_CYAN_UI, BRAND_WARNING } from "../brandColors"
import { DEMO_SCENARIO_LIST, hasRunDemo } from "../demoScenarios"
import type { NordicModeId } from "../nordicModes"
import UpgradeCard from "../UpgradeCard"
import { SourceLine } from "./CellularGroup"
import CraNudge from "./CraNudge"
import DemoHexCard from "./DemoHexCard"
import DockCoachMark, { dockCoachEligible } from "./DockCoachMark"
import EntryDrawer, { type DrawerRun } from "./EntryDrawer"
import EnvStrip, { platformVerdicts, useEnvRefresh } from "./EnvStrip"
import { entryDrawerOpen, entryEnvOpen, entryFirstPrompt, entryRunStart, entryShown, gateShown } from "./entryTelemetry"
import GatePanel from "./GatePanel"
import GatewayLadder from "./GatewayLadder"
import IntentCard from "./IntentCard"
import { oneNotice } from "./notices"
import RequestAccessForm from "./RequestAccessForm"
import ReviewNudge from "./ReviewNudge"
import { runIntent } from "./runIntent"
import { rank } from "./suggest"
import UnlockedCard from "./UnlockedCard"
import { useEntrySignals } from "./useEntrySignals"
import {
	ASK_FOR_DETAILS,
	blg20InstallPrompt,
	CELLULAR_BOARDS,
	CELLULAR_INTENTS,
	DEMO_HEX_PROMPT,
	getTenure,
	type IntentDef,
	isRequestOnlyGroup,
	NO_PROJECT_INTENTS,
	PROJECT_INTENTS,
	resolveIntentPlatform,
} from "./welcomeIntents"

/**
 * The entry surface.
 *
 * One rule decides its shape (`entryMode`): fewer than two sessions, or a month away, and the
 * runs are on screen; otherwise the input leads and one named resume sits under it. The input
 * itself is NOT here — it is the chat composer in the footer, rendered whether or not a task is
 * running, because typing into it already starts a new task. That is the whole "new session"
 * story: no button, because a button would do exactly what typing does.
 *
 * One home per feature. Past sessions live in the drawer and nowhere else — there used to be four
 * places. The suggested runs are one ranked list shown either as cards here or as rows in the
 * drawer, never both at once.
 */

/**
 * Partner devices with a guided product build. The cold-start row names the category, not a
 * vendor — [OPERATOR 2026-09-04] "there will be non-Fanstel ones soon" — and lists these under
 * it, so adding a partner is one line here. The prefill has to name a device (that is what routes
 * a session to the product's own Knowledge bits), so it takes the first and stays editable.
 */
const PARTNER_BUILDS = [
	{ label: "Fanstel LEW840x", opener: "I have a Fanstel LEW840x on the bench and want to start its guided gateway build" },
] as const

interface WelcomeViewProps {
	onSelectMode: (mode: NordicModeId) => void
	onStartTask: (text: string) => Promise<void>
	onStartDemo: (scenarioId: string) => void
	onUpgradeDismiss: () => void
	showUpgradeCard: boolean
}

/** How many ranked runs sit on the surface. The rest are one click away in ☰. */
const CARDS = 3
const ENV_ALWAYS_OPEN_KEY = "adsum.env.alwaysOpen"
const SEEN_RUNS_KEY = "adsum.entry.seenRuns"

const readSeen = (): string[] => {
	try {
		return JSON.parse(localStorage.getItem(SEEN_RUNS_KEY) ?? "[]")
	} catch {
		return []
	}
}

const WelcomeView: React.FC<WelcomeViewProps> = ({
	onSelectMode,
	onStartTask,
	onStartDemo,
	onUpgradeDismiss,
	showUpgradeCard,
}) => {
	const {
		version,
		navigateToHistory,
		nrfEnvironment,
		espEnvironment,
		taskHistory,
		workspaceClassification,
		reviewNudgeShow,
		adsumUnlockedShow,
		adsumAccount,
		announcementRequested,
	} = useExtensionState() as ReturnType<typeof useExtensionState> & {
		adsumAccount?: AdsumAccountState
		announcementRequested?: boolean
	}
	// A locked card opens ONE of two doors. Signed out: the register gate (the tier opens on
	// registration). Signed in but without a by-request group: the request form for that family.
	const [gateFor, setGateFor] = useState<IntentDef | null>(null)
	const [requesting, setRequesting] = useState<"lew840x" | "blg20" | null>(null)
	const hasHistory = (taskHistory?.length ?? 0) > 0
	const { mode, signals, scopeName, isColdStart } = useEntrySignals()
	// Everything the environment has actually seen, for the surfaces that name a board.
	const ladderBoards = [...signals.nrfBoards, ...signals.espDevices]

	const [drawerOpen, setDrawerOpen] = useState(false)
	const [seenRuns, setSeenRuns] = useState<string[]>(readSeen)
	const [craDismissed, setCraDismissed] = useState(false)

	const platform = resolveIntentPlatform(workspaceClassification, signals.toolchains)
	const projectName = scopeName || undefined
	const expanded = mode.mode === "expanded"
	const sampleRun = hasRunDemo(taskHistory)

	// ---- the catalogue: the existing intents, plus the product build, ranked once ----
	const intents: IntentDef[] = signals.hasWorkspace ? PROJECT_INTENTS : NO_PROJECT_INTENTS
	const runs = useMemo(() => {
		const fromIntents: DrawerRun[] = intents.map((i) => ({
			id: i.id,
			icon: i.icon,
			platform: (i.id === "craCheck" ? "both" : platform) as DrawerRun["platform"],
			title: i.title,
			blurb: i.description,
			onRun: () => runIntent(i.id, { onSelectMode, onStartTask, platform, projectName }),
		}))
		const product: DrawerRun = {
			id: "lew840xGateway",
			icon: "circuit-board",
			platform: "product",
			need: "lew840x",
			productLabel: "Fanstel LEW840x",
			// The card title is the thing you would say; the product's full name is where there is
			// room for it. "Fanstel LEW840x composable multi-radio gateway" ran to three bold lines
			// at sidebar width and pushed the card's actual content below the fold of the card.
			title: "Build the LEW840x gateway",
			blurb: "Fanstel's composable multi-radio gateway: BLE in, Ethernet / Wi-Fi / LTE out — with or without the cellular card. Seven steps.",
			meta: "7 steps",
			whyNeutral: "needs the gateway, its UART bridge board and a Nordic DK as probe — the full list comes first",
			needsAlso: "the LEW840x gateway, its UART bridge board and a DK as probe",
			onRun: () =>
				onStartTask("Build the LEW840x gateway: scan BLE tags and publish them to MQTT over Ethernet, Wi-Fi and LTE"),
		}
		/**
		 * ONE home. The cellular and edge-AI cards used to live in a group of their own, below the
		 * suggested runs, with their own note, their own hint line and their own rule — 596 px, 43% of
		 * the entry surface, whatever was on the desk. They rank with everything else now: a card
		 * whose board is connected earns the top of the list on the ranking's own terms, and one whose
		 * board is not sits below what the developer can start today. The lock travels with the card.
		 * [SWEEP 2026-09-09, move 03 — OPERATOR: "do what you recommend"]
		 */
		const handlers = { onSelectMode, onStartTask, platform, projectName }
		const cellular: DrawerRun[] = CELLULAR_INTENTS.map((i) => {
			const locked = !!i.group && !accountHasGroup(adsumAccount, i.group)
			return {
				id: i.id,
				icon: i.icon,
				platform: "product",
				need: i.id === "blg20Gateway" ? "blg20" : "cellular",
				productLabel: i.id === "blg20Gateway" ? "Fanstel BLG20x" : undefined,
				boardMatch: CELLULAR_BOARDS,
				whyNeutral:
					i.id === "edgeAi" ? "needs an nRF54 with the Axon NPU" : "needs an nRF91-family board or a Fanstel gateway",
				// Its own gap, so five rows do not print one sentence five times.
				needsAlso: i.needsAlso,
				title: i.title,
				blurb: i.description,
				locked,
				// The drawer is a second surface for the same cards, so it says the same thing: one
				// phrase for the one door, and "Register" only where registering is what opens it.
				lockPill: locked ? (adsumAccount || isRequestOnlyGroup(i.group) ? ASK_FOR_DETAILS : "Register") : undefined,
				onRun: () => {
					if (!locked) {
						runIntent(i.id, handlers)
						return
					}
					if (!adsumAccount) {
						gateShown("card", i.id)
						setGateFor(i)
						return
					}
					setRequesting(i.id === "blg20Gateway" ? "blg20" : "lew840x")
				},
			}
		})
		return rank<DrawerRun>([product, ...fromIntents, ...cellular], signals)
	}, [intents, platform, projectName, signals, onSelectMode, onStartTask, adsumAccount])

	/**
	 * The demo flash is the strongest one-click proof the product has — and only while there is
	 * nothing else to show. It holds a card on the surface until the install has a task, then it
	 * lives in the drawer with everything else. [SWEEP 2026-09-09, move 04]
	 */
	const demoRun: DrawerRun = useMemo(
		() => ({
			id: "demoHex",
			icon: "rocket",
			platform: "product",
			need: "lew840x",
			productLabel: "Fanstel LEW840x",
			whyNeutral: "needs the LEW840x and its programming kit; nrfutil and esptool on this machine",
			needsAlso: "the LEW840x programming kit, with nrfutil and esptool on this machine",
			title: "Flash the LEW840x demo",
			blurb: "Three signed hexes: BLE scanner, ESP32 uplink, nRF9160 bearer. About three minutes.",
			meta: "≈ 3 min",
			onRun: () => void onStartTask(DEMO_HEX_PROMPT),
		}),
		[onStartTask],
	)
	const drawerRuns = useMemo(
		() => (hasHistory ? [...runs, { item: demoRun, score: 0, why: "", grounded: false }] : runs),
		[runs, demoRun, hasHistory],
	)

	/** Does any suggestion rest on a detection? Decides whether a card may be lit as primary. */
	const anyGrounded = runs.some((r) => r.grounded)
	const samples: DrawerRun[] = useMemo(() => {
		// Named for what each one SHOWS, and ordered gentlest first. The catalogue's own sort puts
		// "new" rows on top, which is right for announcing a capability and wrong for a person who
		// has never seen the tool work.
		const SHOWCASE: Record<string, { title: string; blurb: string }> = {
			"nus-uart": {
				title: "Example debug session",
				blurb: "A real BLE bug on real nRF source: the symptom, the evidence gathered at each step, and the fix.",
			},
			"hci-sniffer": {
				title: "Example debug with a radio sniffer and HCI tracing",
				blurb: "The same bug one layer deeper — app log, HCI bus and over-the-air capture, so you see which layer broke.",
			},
			"cra-sample": {
				title: "Example CRA run",
				blurb: "How a readiness check works on a pre-built gateway build: the SBOM, the known CVEs, and what a conformity file needs.",
			},
		}
		const order = ["nus-uart", "hci-sniffer", "cra-sample"]
		return [...DEMO_SCENARIO_LIST]
			.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
			.map((d) => ({
				id: d.id,
				platform: "both" as const,
				title: SHOWCASE[d.id]?.title ?? d.title,
				blurb: SHOWCASE[d.id]?.blurb ?? d.honestLabel,
				meta: "~1 min · no hardware",
				onRun: () => onStartDemo(d.id),
			}))
	}, [onStartDemo])

	const unseen = runs.map((r) => r.item.id).filter((id) => !seenRuns.includes(id))

	// The environment, two densities. [OPERATOR 2026-09-09, approved v2] The header row IS the
	// collapsed environment; the full view opens under it for the sitting (React state, so a task
	// start closes it) — or always, for the bench, via the checkbox in the band (localStorage).
	const verdicts = platformVerdicts(nrfEnvironment, espEnvironment, !!scopeName)
	const [envOpen, setEnvOpen] = useState<boolean>(() => {
		try {
			return localStorage.getItem(ENV_ALWAYS_OPEN_KEY) === "1"
		} catch {
			return false
		}
	})
	const [envAlwaysOpen, setEnvAlwaysOpen] = useState<boolean>(envOpen)
	const { refresh: refreshEnv, busy: envBusy } = useEnvRefresh()
	const openEnv = (via: "row" | "why") => {
		if (!envOpen) {
			entryEnvOpen(via)
		}
		setEnvOpen(true)
	}
	const exception = verdicts.find((v) => v.state === "exception")
	const envName = verdicts.length
		? verdicts
				.map(
					(v) =>
						`${v.label} ${v.state === "ready" ? "ready" : v.state === "missing" ? "toolchain missing" : v.state === "detecting" ? "detecting" : (v.exception ?? "problem")}`,
				)
				.join(", ")
		: "no toolchain detected"

	// One measurement per paint. Everything else times from here.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => {
		entryShown({
			mode: mode.mode,
			reason: mode.reason,
			hasResume: Boolean(mode.resume),
			sessions: taskHistory?.length ?? 0,
			newestAgeDays: mode.newestAgeDays,
			roots: signals.hasWorkspace ? 1 : 0,
		})
	}, [mode.mode])

	const openDrawer = () => {
		entryDrawerOpen(unseen.length > 0)
		setDrawerOpen(true)
		if (unseen.length) {
			const all = runs.map((r) => r.item.id)
			setSeenRuns(all)
			try {
				localStorage.setItem(SEEN_RUNS_KEY, JSON.stringify(all))
			} catch {
				// per-viewer convenience only; a browser that refuses storage just shows the dot again
			}
		}
	}

	// ---- one grounded promotion per paint, precedence unchanged ----
	const craBanner =
		signals.hasWorkspace &&
		(signals.features.hasBle || signals.features.hasWifi) &&
		!signals.features.hasCompliance &&
		!craDismissed
	const tenure = getTenure({ taskCount: taskHistory?.length ?? 0, showAnnouncement: showUpgradeCard })
	const upgradeShowing = tenure === "dormant" && showUpgradeCard
	/**
	 * ONE notice, chosen by priority — see notices.ts for the order and the reasoning.
	 *
	 * These were five independent booleans with a single guard between two of them, so three could
	 * stack; on the operator's own screen two did. The ad-hoc `!craBanner && !upgradeShowing` guards
	 * that used to sit in the JSX are gone with it: the queue is the only thing that decides now, and
	 * there is one place to read the policy instead of four conditions to reconcile.
	 */
	const notice = oneNotice(
		{
			cra: craBanner,
			dock: dockCoachEligible(signals.hasWorkspace),
			registered: !!adsumUnlockedShow,
			upgrade: upgradeShowing,
			review: !!reviewNudgeShow,
		},
		announcementRequested ? "upgrade" : undefined,
	)
	const craEvidence = `${
		signals.features.hasBle && signals.features.hasWifi ? "BLE & Wi-Fi" : signals.features.hasWifi ? "Wi-Fi" : "BLE"
	} detected · no compliance artifacts in this project yet`

	// What the detectors actually report, named. Not a claim about what will work — a list of what
	// answered when asked.
	const devices = [...signals.nrfBoards, ...signals.espDevices]

	const resumeSession = mode.resume
	// Two lines, clipped by CSS rather than by counting characters. A hard slice cut "The
	// applicatio" mid-word with no ellipsis, which reads as a rendering fault rather than as a
	// title that is simply long.
	const resumeTitle = resumeSession ? resumeSession.task.replace(/\s+/g, " ") : ""
	// How long ago, which is what tells you whether this is the thing you were just doing. The
	// sub-line was spending its width repeating the folder name already in the header above.
	const resumeAge = (() => {
		if (!resumeSession) {
			return ""
		}
		const mins = Math.max(1, Math.round((Date.now() - resumeSession.ts) / 60000))
		if (mins < 60) {
			return `${mins} min ago`
		}
		const hours = Math.round(mins / 60)
		if (hours < 24) {
			return `${hours} h ago`
		}
		const days = Math.round(hours / 24)
		return days === 1 ? "yesterday" : `${days} d ago`
	})()

	return (
		<div className="relative flex flex-1 flex-col px-4 pb-2 pt-3" data-testid="welcome-view" style={{ overflowY: "auto" }}>
			{/* header: identity, and the ONE way to everything not on screen */}
			<div className="mb-2 flex items-center gap-2">
				{/* Named for the THEME they belong to, not the ink: adsumLogoDark is the light-ink
				    artwork for a dark panel (measured wordmark ink 255 vs 10). I once swapped these on
				    a filename guess after misreading a downscaled screenshot as faint, which fixed
				    nothing and blanked the wordmark. Measure the asset, do not read its name.
				    Which one shows is decided in CSS by VS Code's own body class, not by `isDark` —
				    see the .adsum-wordmark rules in index.css for why the React state could go stale
				    and leave a light-theme host showing white ink on a white sidebar. */}
				<img alt="Adsum IoT Coder" className="adsum-wordmark-dark" src={adsumLogoDark} style={{ height: "18px" }} />
				<img alt="" aria-hidden="true" className="adsum-wordmark-light" src={adsumLogoLight} style={{ height: "18px" }} />
				{/* No ☰. [OPERATOR 2026-09-09, approved] It sat 30 px under the host's own ＋ ↺ ⚙ and read as
				    a second menu; what it opened is one click away at the "All runs" line under the cards,
				    and the sessions it listed live in the host's ↺ (HistoryView). The slot it held carries
				    the one-line answer to "where am I, and with what": the folder, and a ✓ per platform
				    whose toolchain is present — MOVED up from the Environment band, not copied (the band
				    keeps the strip, which says the same thing in more detail). Mockup entry-one-door, pin 4. */}
				<div className="group ml-auto flex min-w-0 items-baseline gap-1">
					<button
						aria-expanded={envOpen}
						aria-label={`Environment: ${scopeName ? `${scopeName}, ` : ""}${envName}. ${envOpen ? "Hide" : "Show"} the full view`}
						className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-right hover:border-[var(--vscode-input-border)] hover:bg-[var(--vscode-input-background)] focus-visible:border-[var(--vscode-focusBorder)]"
						data-testid="entry-desk-line"
						onClick={() => (envOpen ? setEnvOpen(false) : openEnv("row"))}
						style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", cursor: "pointer" }}
						title="Environment — click for the full view"
						type="button">
						{scopeName && (
							<span className="flex min-w-0 items-baseline gap-1" style={{ whiteSpace: "nowrap" }}>
								<span
									aria-hidden="true"
									className="codicon codicon-folder"
									style={{ fontSize: "11px", opacity: 0.75 }}
								/>
								<span
									data-testid="entry-scope-title"
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										color: "var(--vscode-foreground)",
										maxWidth: "12em",
									}}
									title={scopeName}>
									{scopeName}
								</span>
							</span>
						)}
						{verdicts.length === 0 && (
							<span data-testid="entry-desk-none" style={{ whiteSpace: "nowrap" }}>
								{scopeName ? " · " : ""}
								no toolchain yet · <span style={{ color: BRAND_CYAN_TEXT }}>what to install →</span>
							</span>
						)}
						{verdicts.map((v) => (
							<span
								data-testid={`entry-desk-${v.label}`}
								key={v.label}
								style={{ whiteSpace: "nowrap", minWidth: "4.5em" }}>
								{" · "}
								{v.label} {v.state === "ready" && <span style={{ color: "var(--vscode-foreground)" }}>✓</span>}
								{v.state === "missing" && <span title={v.toolchain}>—</span>}
								{v.state === "detecting" && <span>…</span>}
								{v.state === "exception" && (
									<span
										data-testid="entry-desk-exception"
										style={{ color: BRAND_WARNING, whiteSpace: "normal" }}>
										⚠ {v.exception?.replace(/ — open for detail$/, "")}
									</span>
								)}
								{v.state === "ready" && v.boards.length === 1 && (
									<span style={{ color: "var(--vscode-foreground)" }}> {v.boards[0]}</span>
								)}
								{v.state !== "exception" && v.boards.length > 1 && <span> {v.boards.length} boards</span>}
							</span>
						))}
						{exception && (
							<span style={{ whiteSpace: "nowrap" }}>
								{" — "}
								<span
									data-testid="entry-desk-why"
									onClick={(e) => {
										e.stopPropagation()
										openEnv("why")
									}}
									style={{ color: BRAND_CYAN_TEXT }}>
									why →
								</span>
							</span>
						)}
						<span
							aria-hidden="true"
							className={`codicon ${envOpen ? "codicon-chevron-up" : "codicon-chevron-right"}`}
							style={{ fontSize: "9px", opacity: 0.6 }}
						/>
					</button>
					<button
						aria-label="Re-probe detected platforms"
						className="codicon codicon-refresh shrink-0 border-0 bg-transparent p-0.5 opacity-0 group-hover:opacity-70 focus-visible:opacity-70"
						data-testid="entry-env-refresh"
						disabled={envBusy}
						onClick={refreshEnv}
						style={{
							fontSize: "11px",
							color: "var(--vscode-descriptionForeground)",
							cursor: envBusy ? "default" : "pointer",
						}}
						title="Re-probe detected platforms"
						type="button"
					/>
				</div>
			</div>

			{/* Where you are, and what is on the desk.
			    [OPERATOR 2026-09-04] The folder was only named in a strip at the BOTTOM, and the
			    connected boards were not shown at all — so the surface never answered the two
			    questions a developer asks on opening it. Devices are stated as detected facts, never
			    a verdict: "no boards detected" is true, useful, and is not a fault. */}
			{/* Band 1, one box. Inside it 4–6 px (one group); after it 16 px (the seam to the next
			    band). Items inside band 2 sit 12 px apart, so the rhythm says which things belong
			    together before a word is read: 4 within a group · 12 between items · 16 between
			    bands. The tip is the band's last line and takes the band's margin, so dismissing it
			    does not change the seam. */}
			<div className="mb-4 flex flex-col gap-0.5">
				{/* The heading sits ABOVE the folder, not between it and the strip: folder and detected
				    hardware are one answer to one question — what am I working on and with — and a
				    heading that only covered the second half left the first half captionless. */}
				{/* The folder line moved UP into the wordmark row (2026-09-09); what stays here is the
				    way to get a folder when there is none. */}
				{scopeName ? null : (
					// [SWEEP 2026-09-04, F2] "No folder open" was a dead statement at the head of the
					// surface. The person who has a project wants to open it; the person who does not
					// wants nothing from this line. One control serves the first and costs the second
					// nothing. Same host call the "open a project" card already uses (runIntent.ts).
					<button
						className="flex items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
						data-testid="entry-scope-title"
						onClick={() => void FileServiceClient.openFolder(StringRequest.create({ value: "" }))}
						style={{ marginLeft: "-4px" }}
						title="Open a folder to work on your project">
						<span
							aria-hidden="true"
							className="codicon codicon-folder-opened"
							style={{ fontSize: "12px", opacity: 0.75 }}
						/>
						<span style={{ fontSize: "13px", fontWeight: 600, color: "var(--vscode-foreground)" }}>
							{/* Short, because at sidebar width the sentence wrapped a bold line — a heavy
							    two-line control for a secondary act. The full sentence is the tooltip. */}
							Open a folder
						</span>
						<span
							aria-hidden="true"
							className="codicon codicon-chevron-right"
							style={{ fontSize: "11px", opacity: 0.6 }}
						/>
					</button>
				)}
				{/* Folder, then hardware, as ONE titled block — [OPERATOR 2026-09-04] "the current
				    folder and detection maybe better in the top but with an appropriate title".
				    Orientation is what you read first, so it belongs where the eye lands, and the two
				    halves answer one question together: where am I, and what is on my desk.

				    They were already one block — StatusHeader had paired them from the start. I split
				    them: my own folder line at the top, the strip left stranded at the bottom of the
				    panel, and device state briefly described in both. Rejoined here, and the strip's
				    old position below the content is gone, so this stays the single home.

				    `entry-devices` survives as an empty landmark so the header's tests keep a stable
				    hook and nothing re-grows a second device line here by accident. */}
				<div className="hidden" data-testid="entry-devices" />
				{/* Suppressed on a cold start. [SCREENSHOT 2026-09-04] A first-time user was met by
				    "No folder open", then "YOUR SETUP", then "No SDK detected" — three lines, all of
				    them absence, above the one thing that works with nothing installed. The samples
				    card below already promises "no hardware, nothing installed", so the SDK line does
				    not just discourage, it argues with the reassurance beside it. With a folder open
				    the strip is orientation and earns the top slot; with nothing at all it is a list
				    of what you do not have. (I suppressed the old header device line for this exact
				    reason, then reintroduced it by moving the strip up unconditionally — the condition
				    has to travel with it.) */}
				{/* The full view — everything the strip knows — under the row that opened it. Closed on
				    every arrival (a task start unmounts this surface); "always open" is the bench's
				    setting. The exception is NOT repeated here on the surface: the row carries it. */}
				{envOpen && (
					<div className="mt-1 flex flex-col gap-1" data-testid="env-band">
						<div
							className="flex flex-wrap items-center justify-between gap-x-2 uppercase"
							style={{ fontSize: "10px", letterSpacing: "0.08em", color: "var(--vscode-descriptionForeground)" }}>
							<span>Environment</span>
							<span className="flex items-center gap-2 normal-case" style={{ letterSpacing: 0 }}>
								<span title="Extension version — the field support asks for">Adsum {version}</span>
								{/* [OPERATOR 2026-09-09] "what is that always open check box?" — the bench's switch
								    (v2, cut 3): the full view closes on every arrival by design; this pins it open
								    for the people who live in the board list. It was a raw browser checkbox and
								    looked it; the toolkit's control matches the panel. */}
								<VSCodeCheckbox
									checked={envAlwaysOpen}
									data-testid="env-always-open"
									onChange={(e: any) => {
										const on = !!e.target?.checked
										setEnvAlwaysOpen(on)
										try {
											if (on) {
												localStorage.setItem(ENV_ALWAYS_OPEN_KEY, "1")
												entryEnvOpen("always")
											} else {
												localStorage.removeItem(ENV_ALWAYS_OPEN_KEY)
											}
										} catch {}
									}}
									style={{ fontSize: "10px" }}
									title="Keep the full view open on every visit — the bench's setting">
									always open
								</VSCodeCheckbox>
							</span>
						</div>
						<EnvStrip forceExpanded />
					</div>
				)}

				{/* [OPERATOR 2026-09-04] Moved back to the top, on their call. It was below the content
			    because as a bordered card with a lightbulb it out-shouted the resume; now that it is a
			    single quiet line the objection is spent, and one line above the fold is what a
			    dismissible one-time hint is supposed to cost. It sits under the environment group so
			    it reads as chrome rather than as the first suggestion. */}
				{notice === "dock" && <DockCoachMark hasProject={signals.hasWorkspace} />}
			</div>

			{/* One block, flowing from the top, with the composer pinned below by the chat layout and a
			    single space between. Two earlier attempts moved that space around — first stranding the
			    content at the top of a screen-high void, then splitting it into a header up here and a
			    cluster down there with a canyon in the middle, which reads as a layout fault. Sparse
			    content in a tall column always leaves space somewhere; the honest place is one gap
			    above the input, not a gap in the middle of the content. */}
			<div className="flex w-full flex-col gap-3">
				{notice === "upgrade" && (
					<UpgradeCard
						onAction={
							adsumAccount
								? undefined
								: () => {
										gateShown("card", CELLULAR_INTENTS[0].id)
										setGateFor(CELLULAR_INTENTS[0])
									}
						}
						onDismiss={onUpgradeDismiss}
					/>
				)}
				{notice === "review" && (
					<ReviewNudge
						onDismiss={() => StateServiceClient.dismissBanner({ value: "review-nudge" }).catch(console.error)}
						onReview={() => {
							WebServiceClient.openInBrowser({
								value: "https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger&ssr=false#review-details",
							}).catch(console.error)
							StateServiceClient.dismissBanner({ value: "review-nudge" }).catch(console.error)
						}}
					/>
				)}
				{notice === "cra" && (
					<CraNudge
						evidence={craEvidence}
						onDismiss={() => setCraDismissed(true)}
						onPreview={() => runIntent("craCheck", { onSelectMode, onStartTask, platform, projectName })}
					/>
				)}

				{/* The resume, whenever there is one — not only when the surface has collapsed.
				    [OPERATOR 2026-09-04] "why is resume previous session not showing here": after ONE
				    session in a folder the rule keeps the cards on screen (a habit is not yet formed),
				    and the resume was rendered only in the collapsed branch, so the one act a person
				    most wants after their first session was the one thing missing. Cards teach; the
				    resume continues. They are not alternatives. When both show, the resume is the
				    cyan focal point and the first card gives its frame up — one focal point, still. */}
				{resumeSession && (
					<button
						className="w-full rounded-md px-3 py-2 text-left"
						data-testid="entry-resume"
						onClick={() => {
							entryFirstPrompt("resume")
							TaskServiceClient.showTaskWithId(StringRequest.create({ value: resumeSession.id })).catch(
								console.error,
							)
						}}
						style={{
							border: `1px solid ${BRAND_CYAN_UI}`,
							background: "var(--vscode-inputOption-activeBackground)",
						}}>
						<div className="flex items-start gap-2">
							<div
								className="min-w-0 flex-1"
								style={{
									fontSize: "12px",
									fontWeight: 600,
									color: "var(--vscode-foreground)",
									display: "-webkit-box",
									WebkitLineClamp: 2,
									WebkitBoxOrient: "vertical",
									overflow: "hidden",
								}}>
								Resume — {resumeTitle}
							</div>
							{/* [F12] The one control on the returning surface had no affordance beyond the
						    word "Resume" in its own title. */}
							<span
								aria-hidden="true"
								className="codicon codicon-play shrink-0"
								style={{ fontSize: "13px", color: BRAND_CYAN_TEXT, marginTop: "1px" }}
							/>
						</div>
						<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginTop: "2px" }}>
							{/* Where the others are is said once, by the composer label below. Repeating it
						    on the card spends the one line that could carry something only this card knows. */}
							{mode.resumeKind === "handover" ? "your agent's session · " : ""}
							{resumeAge}
						</div>
					</button>
				)}

				{expanded ? (
					<>
						<div>
							{/* [OPERATOR 2026-09-04] "remove 'Let's get your board talking' — stay dev oriented
							    and pro". A headline that greets rather than informs is the wrong register for
							    someone who opened the panel to do work, and in the ordinary case it also said
							    nothing the row of cards underneath did not already say. Two states keep a
							    headline because it carries information the cards cannot: the cold start states
							    what these samples are FOR, and a lapsed return explains why the cards came back
							    after a month away. */}
							{(isColdStart || mode.reason === "lapsed") && (
								<div style={{ fontSize: "14px", fontWeight: 600, color: "var(--vscode-foreground)" }}>
									{isColdStart ? "See it work first." : "Welcome back."}
								</div>
							)}
							<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "2px" }}>
								{/* Never "Working on <folder>": the Environment group at the top of the panel
								    already names the folder, and repeating it here read as a stutter. */}
								{/* [F5] The triple-"real" was marketing voice. [F9] The working-case sentence moved
								    into the SUGGESTED RUNS row, so this line renders only when it has something
								    of its own to say. */}
								{isColdStart ? "Pick one and watch a real session do a real job, with nothing to install." : null}
							</div>
							{/* A first visit to THIS folder by someone who has worked in others. The runs above answer
							    what to do; this line answers where everything else went. */}
							{mode.reason === "no-resume-here" && mode.elsewhereCount > 0 && (
								<div
									data-testid="entry-orientation"
									style={{
										fontSize: "12px",
										color: "var(--vscode-descriptionForeground)",
										marginTop: "4px",
									}}>
									{/* [SWEEP 2026-09-09, return-user] With no folder this read "Nothing has run in  yet". */}
									Nothing has run in <b>{scopeName || "this window"}</b> yet —{" "}
									<button
										data-testid="entry-elsewhere"
										onClick={() => navigateToHistory()}
										style={{ color: BRAND_CYAN_TEXT, textDecoration: "underline" }}>
										your {mode.elsewhereCount} session{mode.elsewhereCount > 1 ? "s" : ""} in other folders
									</button>{" "}
									{/* [OPERATOR 2026-09-04] The glyph goes BEFORE the word, because it is the thing
									    being named, not a decoration after it — and this is the only place the copy
									    can teach which control it means. [2026-09-09] That control is now the host's
									    own ↺ History in the title bar: the drawer no longer lists sessions. */}
									are in{" "}
									<span aria-hidden="true" className="codicon codicon-history" style={{ fontSize: "11px" }} />{" "}
									History.
								</div>
							)}
						</div>

						{/* The receipt for the thing the developer just did, at the TOP.
						    [OPERATOR 2026-09-06] It used to sit below the three suggested runs, next to the
						    demo hex and the four cards it describes — the reasoning being "first the words,
						    then the one thing they can run right now". Read in a real editor a second after
						    the callback landed, that reasoning is wrong: this is not an offer competing with
						    the runs, it is the ANSWER to an action, and an answer three cards down is not one.
						    Dismissible, and once dismissed the panel is exactly what it was. */}
						{notice === "registered" && (
							<UnlockedCard
								onDismiss={() =>
									StateServiceClient.dismissBanner({ value: ADSUM_REGISTERED_BANNER }).catch(console.error)
								}
							/>
						)}

						{isColdStart && !sampleRun ? (
							<>
								{/* The cold start. Every run below needs hardware this person may not have, and each
							    only prefills. A sample is pre-canned and safe, so it can fire on one click — the
							    shortest honest path to seeing anything work. */}
								<div
									className="flex flex-col gap-1.5 rounded-lg p-2"
									data-testid="entry-samples"
									style={{ border: `1px solid ${BRAND_CYAN_UI}` }}>
									{/* [SWEEP 2026-09-04, F1] Tracked caps wrap badly: two caps lines became four at
								    sidebar width. One short caps label, and the qualifier in sentence case, where
								    wrapping costs nothing. */}
									<div className="px-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
										<div className="uppercase" style={{ fontSize: "10px", letterSpacing: "0.08em" }}>
											Sample runs
										</div>
										<div style={{ fontSize: "11px" }}>About a minute each · nothing to install</div>
									</div>
									{samples.map((s, idx) => (
										<button
											className="flex items-start gap-2 rounded p-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
											data-testid="entry-sample"
											key={s.id}
											onClick={() => {
												entryRunStart(s.id, "sample")
												s.onRun()
											}}>
											<span
												aria-hidden="true"
												className="codicon codicon-play"
												style={{ fontSize: "11px", color: idx === 0 ? BRAND_CYAN_TEXT : undefined }}
											/>
											<span className="flex min-w-0 flex-1 flex-col">
												{/* Wraps, never truncates. [SCREENSHOT r16] "Example debug with a radio sni…"
											    on a list of three, and the first title cut to "Example debug ses…" by the cue
											    sitting beside it. Three rows have room for two lines each. */}
												<span style={{ fontSize: "12px", fontWeight: 600 }}>{s.title}</span>
												<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
													{/* [F3] Three equal rows answered nothing for the person whose one question
												    is "which do I click first". The cue leads the description of the first
												    row — on the row, not a tag on the run, and never in the title's width. */}
													{idx === 0 && (
														<span style={{ fontWeight: 600, color: BRAND_CYAN_TEXT }}>
															Start here —{" "}
														</span>
													)}
													{s.blurb}
												</span>
											</span>
											{/* No per-row duration: the header says "about a minute each", and three rows
										    repeating "~1 min" only crowd the titles they sit beside. */}
										</button>
									))}
								</div>
								{/* Outside the samples box on purpose. The box promises "no hardware, nothing to
							    install"; a guided product build is real hardware, seven steps and half an hour,
							    and putting it inside would make that line false the first time it was clicked.
							    Before this row the flagship build was invisible on a cold start — it only
							    surfaced as a suggested run once a folder was open. */}
								<button
									className="flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
									data-testid="entry-partner-build"
									onClick={() => {
										entryRunStart("partnerBuild", "card")
										onStartTask(PARTNER_BUILDS[0].opener)
									}}
									title="Prefills the opener — nothing runs until you press Enter">
									<span
										aria-hidden="true"
										className="codicon codicon-circuit-board shrink-0"
										style={{ fontSize: "13px", marginTop: "2px", color: BRAND_CORAL }}
									/>
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span style={{ fontSize: "12px", fontWeight: 600, color: "var(--vscode-foreground)" }}>
											Have a supported partner device on the bench?
										</span>
										<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
											Start its guided build — real hardware, step by step, the parts list first. Today:{" "}
											{PARTNER_BUILDS.map((p) => p.label).join(", ")}.
										</span>
									</span>
									<span
										aria-hidden="true"
										className="codicon codicon-chevron-right shrink-0"
										style={{ fontSize: "11px", opacity: 0.6, marginTop: "2px" }}
									/>
								</button>
								{/* The cold start's door. [SWEEP 2026-09-09, screenshot vs mockup v4.7 "Browse suggested
								    runs"] Cutting the ☰ left this shape with NO way into the drawer, and the drawer is
								    where the suggested runs — and the locked cellular offer with its Register gate —
								    live when there is no folder. "Hiding it until sign-in would mean nobody ever learns
								    it exists" (CellularGroup, 09-06) applied here too, and the cut had silently undone it.
								    Same name as everywhere else: one door, one name. */}
								<button
									className="self-start bg-transparent border-0 p-0 text-left"
									data-testid="entry-more-runs"
									onClick={openDrawer}
									style={{ fontSize: "11px", color: BRAND_CYAN_TEXT, cursor: "pointer", fontWeight: 600 }}
									type="button">
									All runs →
								</button>
							</>
						) : (
							<>
								{/* [SWEEP 2026-09-04, F9] "Pick a step, or just say what you want below." floated
								    as its own paragraph directly above this label, and the two said the same
								    thing. One row: the label, and its alternative in sentence case beside it. */}
								<div
									className="flex flex-wrap items-baseline gap-x-2"
									style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
									<span className="uppercase" style={{ letterSpacing: "0.08em" }}>
										Suggested runs
									</span>
									{/* With no detection behind any card the ranking is a shrug, and the honest
									    thing is to say so ONCE here rather than on every card — and to light no
									    card as primary, since a cyan frame with no reason under it is a
									    recommendation the signals never made (colour is never a verdict). */}
									<span style={{ fontSize: "11px" }}>
										{anyGrounded
											? "or describe what you want below"
											: "no board detected — showing a mix · or describe what you want below"}
									</span>
								</div>
								{runs.slice(0, CARDS).map((r, idx) => (
									<React.Fragment key={r.item.id}>
										<IntentCard
											description={r.item.blurb ?? ""}
											// One cyan focal point, and it is whatever the signals actually ranked
											// first. Three cards shouting equally is the same as none of them
											// leading — the eye has nowhere to land and the ranking is wasted.
											icon={r.item.icon ?? "rocket"}
											locked={r.item.locked}
											onClick={() => {
												entryRunStart(r.item.id, "card")
												r.item.onRun()
											}}
											onLocked={r.item.locked ? r.item.onRun : undefined}
											pill={r.item.locked ? r.item.lockPill : undefined}
											primary={idx === 0 && anyGrounded && !resumeSession && !r.item.locked}
											// [F7] Same rule as the drawer: a reason earns its line only when it names
											// something detected. "works on nRF and on ESP32" on three cards in a row
											// was the one thing every card said and the loudest text on each.
											subline={r.grounded ? `◆ ${r.why}` : undefined}
											sublineColor={BRAND_CYAN_TEXT}
											testId={`entry-run-${r.item.id}`}
											title={r.item.title}
										/>
										{/* The template-source request belongs to the LEW840x card and reads as its
										    sub-line. A sibling, not a child: the card is a button, and a control
										    inside a button is unreachable by keyboard. */}
										{r.item.id === "cellularGateway" && !r.item.locked && (
											<SourceLine onRequest={() => setRequesting("lew840x")} />
										)}
									</React.Fragment>
								))}
								{/* The ONE door to the drawer, and it is always here in this branch: the sample
								    runs and every run past the third card live only in the drawer once a folder is
								    open, so there is always something behind it. (A cold start shows the samples
								    on the surface itself and hides nothing, so it has no door — nothing to reach.)
								    [OPERATOR 2026-09-09, approved] The ☰ that used to duplicate this is gone; its
								    coral "unseen runs" dot moved here, same rule: only once at least one run has
								    been opened, never as a nag on a first visit. */}
								<button
									className="relative self-start bg-transparent border-0 p-0 text-left"
									data-testid="entry-more-runs"
									onClick={openDrawer}
									style={{ fontSize: "11px", color: BRAND_CYAN_TEXT, cursor: "pointer", fontWeight: 600 }}
									type="button">
									All runs
									{runs.length > CARDS ? ` · ${runs.length - CARDS} more` : ""}
									{hasHistory ? ", and the demo flash" : ""} →
									{unseen.length > 0 && unseen.length < runs.length && (
										<span
											data-testid="entry-more-runs-badge"
											style={{
												position: "absolute",
												top: "-2px",
												right: "-9px",
												width: "7px",
												height: "7px",
												borderRadius: "50%",
												background: BRAND_CORAL,
											}}
										/>
									)}
								</button>
							</>
						)}
						{/* Cellular & gateways, always present — locked until the developer registers, live after.
						    It sits AFTER the suggested runs because it is a second offer, not a competing one:
						    everything above works today with no account at all, and this group says plainly what
						    a free account adds. Hiding it until sign-in would mean nobody ever learns it exists. */}
						<GatewayLadder
							boards={ladderBoards}
							chips={signals.nrfChips ?? []}
							onAsk={() => setRequesting("blg20")}
							onInstall={(way) => void onStartTask(blg20InstallPrompt(way))}
							onStart={() => {
								entryRunStart("blg20Gateway", "card")
								runIntent("blg20Gateway", { onSelectMode, onStartTask, platform, projectName })
							}}
						/>
						{!hasHistory && <DemoHexCard boards={ladderBoards} onFlash={(prompt) => void onStartTask(prompt)} />}
						<RequestAccessForm
							family={requesting ?? undefined}
							onClose={() => setRequesting(null)}
							open={requesting !== null}
						/>
						<GatePanel
							email={adsumAccount?.email}
							onClose={() => setGateFor(null)}
							open={gateFor !== null}
							satisfied={!!gateFor?.group && accountHasGroup(adsumAccount, gateFor.group)}
							surface="card"
							variant={adsumAccount && !adsumAccount.emailVerified ? "verify" : "default"}
						/>
					</>
				) : resumeSession ? (
					/* Collapsed: the resume and the composer, nothing else — except the one door and,
					   when the board is on the desk, the ladder. A developer who has already run
					   something on this board is the LAST person who should be unable to see the ways:
					   the first mount of this card sat in the branch this shape does not paint, which
					   is why it never appeared on the bench. [BENCH 2026-09-14]
					   The runs, checks and samples are all still in the drawer. */
					<>
						<GatewayLadder
							boards={ladderBoards}
							chips={signals.nrfChips ?? []}
							onAsk={() => setRequesting("blg20")}
							onInstall={(way) => void onStartTask(blg20InstallPrompt(way))}
							onStart={() => {
								entryRunStart("blg20Gateway", "card")
								runIntent("blg20Gateway", { onSelectMode, onStartTask, platform, projectName })
							}}
						/>
						<button
							className="self-start bg-transparent border-0 p-0 text-left"
							data-testid="entry-more-runs"
							onClick={openDrawer}
							style={{ fontSize: "11px", color: BRAND_CYAN_TEXT, cursor: "pointer", fontWeight: 600 }}
							type="button">
							All runs{hasHistory ? ", and the demo flash" : ""} →
						</button>
					</>
				) : (
					<div
						data-testid="entry-orientation"
						style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
						Nothing has run in <b>{scopeName || "this window"}</b> yet — the box below starts its first session.
						{mode.elsewhereCount > 0 && (
							<>
								{" "}
								{/* A count with no way to reach it is a dead end; this is the way there. */}
								<button
									data-testid="entry-elsewhere"
									onClick={() => navigateToHistory()}
									style={{ color: BRAND_CYAN_TEXT, textDecoration: "underline" }}>
									{mode.elsewhereCount} session{mode.elsewhereCount > 1 ? "s" : ""} in other folders
								</button>
								.
							</>
						)}
					</div>
				)}
			</div>

			<EntryDrawer
				checks={[]}
				onClose={() => setDrawerOpen(false)}
				open={drawerOpen}
				runs={drawerRuns}
				samples={samples}
				unseenRunIds={unseen}
			/>
		</div>
	)
}

export default WelcomeView
