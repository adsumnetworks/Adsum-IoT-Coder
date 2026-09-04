import { StringRequest } from "@shared/proto/cline/common"
import React, { useEffect, useMemo, useState } from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { StateServiceClient, TaskServiceClient, WebServiceClient } from "@/services/grpc-client"
import { BRAND_CORAL, BRAND_CYAN_600, BRAND_SUCCESS } from "../brandColors"
import { DEMO_SCENARIO_LIST, hasRunDemo } from "../demoScenarios"
import type { NordicModeId } from "../nordicModes"
import UpgradeCard from "../UpgradeCard"
import CraNudge from "./CraNudge"
import DockCoachMark from "./DockCoachMark"
import EntryDrawer, { type DrawerRun } from "./EntryDrawer"
import { entryDrawerOpen, entryFirstPrompt, entryRunStart, entryShown } from "./entryTelemetry"
import IntentCard from "./IntentCard"
import ReviewNudge from "./ReviewNudge"
import { runIntent } from "./runIntent"
import StatusHeader from "./StatusHeader"
import { rank } from "./suggest"
import { useEntrySignals } from "./useEntrySignals"
import { getTenure, type IntentDef, NO_PROJECT_INTENTS, PROJECT_INTENTS, resolveIntentPlatform } from "./welcomeIntents"

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

interface WelcomeViewProps {
	onSelectMode: (mode: NordicModeId) => void
	onStartTask: (text: string) => Promise<void>
	onStartDemo: (scenarioId: string) => void
	onUpgradeDismiss: () => void
	showUpgradeCard: boolean
}

/** How many ranked runs sit on the surface. The rest are one click away in ☰. */
const CARDS = 3
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
	const { isDark } = useVSCodeTheme()
	const { version, taskHistory, workspaceClassification, reviewNudgeShow } = useExtensionState()
	const { mode, signals, scopeName, isColdStart } = useEntrySignals()

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
			title: "Fanstel LEW840x composable multi-radio gateway",
			blurb: "BLE in, Ethernet / Wi-Fi / LTE out — with or without the cellular card. Seven steps.",
			meta: "7 steps",
			whyNeutral: "needs the gateway, its UART bridge board and a Nordic DK as probe — the full list comes first",
			onRun: () =>
				onStartTask("Build the LEW840x gateway: scan BLE tags and publish them to MQTT over Ethernet, Wi-Fi and LTE"),
		}
		return rank<DrawerRun>([product, ...fromIntents], signals)
	}, [intents, platform, projectName, signals, onSelectMode, onStartTask])

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
				blurb: "How a readiness check works on a pre-built reference build: the SBOM, the known CVEs, and what a conformity file needs.",
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

	// One measurement per paint. Everything else times from here.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => {
		entryShown({
			mode: mode.mode,
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
	const upgradeShowing = tenure === "dormant" && showUpgradeCard && !craBanner
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
				{/* The variants are named for the INK, not the background: adsumLogoDark is the dark-ink
				    artwork, which belongs on a LIGHT panel. Pairing it with isDark put dark ink on a dark
				    background and the mark all but disappeared. Inherited from the previous surface. */}
				<img alt="Adsum IoT Coder" src={isDark ? adsumLogoLight : adsumLogoDark} style={{ height: "18px" }} />
				<button
					aria-label="Browse sessions and runs"
					className="relative ml-auto rounded px-1.5 py-0.5 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
					data-testid="entry-burger"
					onClick={openDrawer}
					title="Browse sessions and runs">
					<span aria-hidden="true" className="codicon codicon-menu" />
					{unseen.length > 0 && (
						<span
							data-testid="entry-burger-badge"
							style={{
								position: "absolute",
								top: "-1px",
								right: "-1px",
								width: "7px",
								height: "7px",
								borderRadius: "50%",
								background: BRAND_CORAL,
							}}
						/>
					)}
				</button>
			</div>

			{/* Where you are, and what is on the desk.
			    [OPERATOR 2026-09-04] The folder was only named in a strip at the BOTTOM, and the
			    connected boards were not shown at all — so the surface never answered the two
			    questions a developer asks on opening it. Devices are stated as detected facts, never
			    a verdict: "no boards detected" is true, useful, and is not a fault. */}
			<div className="mb-3 flex flex-col gap-0.5">
				<div className="flex items-baseline gap-1.5">
					<span aria-hidden="true" className="codicon codicon-folder" style={{ fontSize: "12px", opacity: 0.75 }} />
					<span
						data-testid="entry-scope-title"
						style={{ fontSize: "13px", fontWeight: 600, color: "var(--vscode-foreground)" }}>
						{scopeName || "No folder open"}
					</span>
				</div>
				{/* On a cold start this line is suppressed. Someone opening the tool for the first time
				    was greeted by "No folder open" followed by "no boards detected" — two statements of
				    absence before anything they could act on. With a folder open it is orientation;
				    with nothing at all it is just discouraging, and the samples below are the point. */}
				<div
					className="flex flex-wrap items-center gap-x-1.5"
					data-testid="entry-devices"
					hidden={isColdStart && devices.length === 0}
					style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
					{devices.length > 0 ? (
						<>
							<span
								style={{
									width: "6px",
									height: "6px",
									borderRadius: "50%",
									background: BRAND_SUCCESS,
									display: "inline-block",
								}}
							/>
							{devices.join(" · ")}
						</>
					) : (
						<>no boards detected</>
					)}
				</div>
			</div>

			{/* Collapsed has very little content, and top-anchoring it left a screen-high void between
			    the resume and the composer. The resume IS an action, so it belongs next to the other
			    action rather than a screen away from it — the header keeps the top for orientation.
			    Expanded fills the space with cards and stays where it is. */}
			<div className={`flex w-full flex-1 flex-col gap-3${expanded ? "" : " justify-end"}`}>
				{upgradeShowing && <UpgradeCard onDismiss={onUpgradeDismiss} version={version ?? ""} />}
				{!craBanner && !upgradeShowing && reviewNudgeShow && (
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
				{craBanner && (
					<CraNudge
						evidence={craEvidence}
						onDismiss={() => setCraDismissed(true)}
						onPreview={() => runIntent("craCheck", { onSelectMode, onStartTask, platform, projectName })}
					/>
				)}

				{expanded ? (
					<>
						<div>
							<div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--vscode-foreground)" }}>
								{isColdStart
									? "See it work first."
									: mode.reason === "lapsed"
										? "Welcome back."
										: "Let's get your board talking."}
							</div>
							<div style={{ fontSize: "11.5px", color: "var(--vscode-descriptionForeground)", marginTop: "2px" }}>
								{/* A folder we have never worked in gets its own line just below saying exactly that,
								    so this one must not ALSO open with "Working on X" — two sentences about the same
								    folder, stacked, read as a stutter. */}
								{isColdStart
									? "Pick one and watch a real session do a real job — real curated knowledge, real commands, real evidence."
									: mode.reason === "no-resume-here"
										? "Pick a step, or just say what you want below."
										: projectName
											? `Working on ${projectName} — pick a step, or just say what you want below.`
											: "Describe what you want to build, or start from one of these."}
							</div>
							{/* A first visit to THIS folder by someone who has worked in others. The runs above answer
							    what to do; this line answers where everything else went. */}
							{mode.reason === "no-resume-here" && mode.elsewhereCount > 0 && (
								<div
									data-testid="entry-orientation"
									style={{
										fontSize: "11.5px",
										color: "var(--vscode-descriptionForeground)",
										marginTop: "4px",
									}}>
									Nothing has run in <b>{scopeName}</b> yet —{" "}
									<button
										data-testid="entry-elsewhere"
										onClick={openDrawer}
										style={{ color: BRAND_CYAN_600, textDecoration: "underline" }}>
										your {mode.elsewhereCount} session{mode.elsewhereCount > 1 ? "s" : ""} in other folders
									</button>{" "}
									are in the menu.
								</div>
							)}
						</div>

						{isColdStart && !sampleRun ? (
							// The cold start. Every run below needs hardware this person may not have, and each
							// only prefills. A sample is pre-canned and safe, so it can fire on one click — the
							// shortest honest path to seeing anything work.
							<div
								className="flex flex-col gap-1.5 rounded-lg p-2"
								data-testid="entry-samples"
								style={{ border: `1px solid ${BRAND_CYAN_600}` }}>
								<div
									className="px-1 uppercase"
									style={{
										fontSize: "10px",
										letterSpacing: "0.06em",
										color: "var(--vscode-descriptionForeground)",
									}}>
									Sample runs · about a minute each · no hardware, nothing installed
								</div>
								{samples.map((s) => (
									<button
										className="flex items-start gap-2 rounded p-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
										data-testid="entry-sample"
										key={s.id}
										onClick={() => {
											entryRunStart(s.id, "sample")
											s.onRun()
										}}>
										<span aria-hidden="true" className="codicon codicon-play" style={{ fontSize: "11px" }} />
										<span className="flex min-w-0 flex-1 flex-col">
											<span style={{ fontSize: "12.5px", fontWeight: 600 }}>{s.title}</span>
											<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
												{s.blurb}
											</span>
										</span>
										<span style={{ fontSize: "10.5px", color: "var(--vscode-descriptionForeground)" }}>
											~1 min
										</span>
									</button>
								))}
							</div>
						) : (
							<>
								<div
									className="uppercase"
									style={{
										fontSize: "10.5px",
										letterSpacing: "0.09em",
										color: "var(--vscode-descriptionForeground)",
									}}>
									Suggested runs
								</div>
								{runs.slice(0, CARDS).map((r, idx) => (
									<IntentCard
										description={r.item.blurb ?? ""}
										// One cyan focal point, and it is whatever the signals actually ranked
										// first. Three cards shouting equally is the same as none of them
										// leading — the eye has nowhere to land and the ranking is wasted.
										icon={r.item.icon ?? "rocket"}
										key={r.item.id}
										onClick={() => {
											entryRunStart(r.item.id, "card")
											r.item.onRun()
										}}
										primary={idx === 0}
										subline={`◆ ${r.why}`}
										sublineColor={BRAND_CYAN_600}
										testId={`entry-run-${r.item.id}`}
										title={r.item.title}
									/>
								))}
							</>
						)}
					</>
				) : resumeSession ? (
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
							border: `1px solid ${BRAND_CYAN_600}`,
							background: "var(--vscode-inputOption-activeBackground)",
						}}>
						<div
							style={{
								fontSize: "12.5px",
								fontWeight: 600,
								color: "var(--vscode-foreground)",
								display: "-webkit-box",
								WebkitLineClamp: 2,
								WebkitBoxOrient: "vertical",
								overflow: "hidden",
							}}>
							Resume — {resumeTitle}
						</div>
						<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginTop: "2px" }}>
							{mode.resumeKind === "handover" ? "your agent's session · " : ""}
							{resumeAge} · every other session is in the menu, top right
						</div>
					</button>
				) : (
					<div
						data-testid="entry-orientation"
						style={{ fontSize: "11.5px", color: "var(--vscode-descriptionForeground)" }}>
						Nothing has run in <b>{scopeName || "this window"}</b> yet — the box below starts its first session.
						{mode.elsewhereCount > 0 && (
							<>
								{" "}
								{/* A count with no way to reach it is a dead end; this is the way there. */}
								<button
									data-testid="entry-elsewhere"
									onClick={openDrawer}
									style={{ color: BRAND_CYAN_600, textDecoration: "underline" }}>
									{mode.elsewhereCount} session{mode.elsewhereCount > 1 ? "s" : ""} in other folders
								</button>
								.
							</>
						)}
					</div>
				)}

				{/* Below the content, not above it: a tip about docking the panel was the loudest, boxiest
				    thing on screen and sat over the actual purpose of the surface. */}
				{/* The header at the top now owns WHERE you are and WHAT is plugged in, so the strip must
				    not say it again — the folder was appearing twice on one screen and the same board was
				    described in two places. Passing null leaves the strip its own job: toolchain and build
				    state, which the header does not cover. */}
				<StatusHeader projectName={null} />
				{/* The tip and the strip are the quiet tail of the surface. Pushing them down puts the
				    empty space ABOVE them rather than below, so the panel ends near the composer instead
				    of stranding its content at the top of a long void. */}
				<div className="mt-auto" />
				<DockCoachMark hasProject={signals.hasWorkspace} />
			</div>

			<EntryDrawer
				checks={[]}
				history={taskHistory ?? []}
				onClose={() => setDrawerOpen(false)}
				open={drawerOpen}
				runs={runs}
				samples={samples}
				unseenRunIds={unseen}
			/>
		</div>
	)
}

export default WelcomeView
