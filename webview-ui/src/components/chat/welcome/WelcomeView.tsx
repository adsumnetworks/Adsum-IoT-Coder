import { StringRequest } from "@shared/proto/cline/common"
import React, { useEffect, useMemo, useState } from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, StateServiceClient, TaskServiceClient, WebServiceClient } from "@/services/grpc-client"
import { BRAND_CORAL, BRAND_CYAN_TEXT, BRAND_CYAN_UI } from "../brandColors"
import { DEMO_SCENARIO_LIST, hasRunDemo } from "../demoScenarios"
import type { NordicModeId } from "../nordicModes"
import UpgradeCard from "../UpgradeCard"
import CellularGroup from "./CellularGroup"
import CraNudge from "./CraNudge"
import DockCoachMark from "./DockCoachMark"
import EntryDrawer, { type DrawerRun } from "./EntryDrawer"
import EnvStrip from "./EnvStrip"
import { entryDrawerOpen, entryFirstPrompt, entryRunStart, entryShown } from "./entryTelemetry"
import IntentCard from "./IntentCard"
import ReviewNudge from "./ReviewNudge"
import { runIntent } from "./runIntent"
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
			// The card title is the thing you would say; the product's full name is where there is
			// room for it. "Fanstel LEW840x composable multi-radio gateway" ran to three bold lines
			// at sidebar width and pushed the card's actual content below the fold of the card.
			title: "Build the LEW840x gateway",
			blurb: "Fanstel's composable multi-radio gateway: BLE in, Ethernet / Wi-Fi / LTE out — with or without the cellular card. Seven steps.",
			meta: "7 steps",
			whyNeutral: "needs the gateway, its UART bridge board and a Nordic DK as probe — the full list comes first",
			onRun: () =>
				onStartTask("Build the LEW840x gateway: scan BLE tags and publish them to MQTT over Ethernet, Wi-Fi and LTE"),
		}
		return rank<DrawerRun>([product, ...fromIntents], signals)
	}, [intents, platform, projectName, signals, onSelectMode, onStartTask])

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
				{/* Named for the THEME they belong to, not the ink: adsumLogoDark is the light-ink
				    artwork for a dark panel (measured wordmark ink 255 vs 10). I once swapped these on
				    a filename guess after misreading a downscaled screenshot as faint, which fixed
				    nothing and blanked the wordmark. Measure the asset, do not read its name.
				    Which one shows is decided in CSS by VS Code's own body class, not by `isDark` —
				    see the .adsum-wordmark rules in index.css for why the React state could go stale
				    and leave a light-theme host showing white ink on a white sidebar. */}
				<img alt="Adsum IoT Coder" className="adsum-wordmark-dark" src={adsumLogoDark} style={{ height: "18px" }} />
				<img alt="" aria-hidden="true" className="adsum-wordmark-light" src={adsumLogoLight} style={{ height: "18px" }} />
				<button
					aria-label="Browse sessions and runs"
					className="relative ml-auto rounded px-1.5 py-0.5 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
					data-testid="entry-burger"
					onClick={openDrawer}
					title="Browse sessions and runs">
					<span aria-hidden="true" className="codicon codicon-menu" />
					{/* [SWEEP 2026-09-04, F4] A coral dot for "runs you have not seen" on a first visit,
					    when nothing has been seen, is a nag rather than a signal. It appears once there is
					    at least one run the developer HAS opened. */}
					{unseen.length > 0 && unseen.length < runs.length && (
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
			{/* Band 1, one box. Inside it 4–6 px (one group); after it 16 px (the seam to the next
			    band). Items inside band 2 sit 12 px apart, so the rhythm says which things belong
			    together before a word is read: 4 within a group · 12 between items · 16 between
			    bands. The tip is the band's last line and takes the band's margin, so dismissing it
			    does not change the seam. */}
			<div className="mb-4 flex flex-col gap-0.5">
				{/* The heading sits ABOVE the folder, not between it and the strip: folder and detected
				    hardware are one answer to one question — what am I working on and with — and a
				    heading that only covered the second half left the first half captionless. */}
				{!isColdStart && (
					<div
						className="uppercase"
						style={{ fontSize: "10px", letterSpacing: "0.08em", color: "var(--vscode-descriptionForeground)" }}>
						Environment
					</div>
				)}
				{scopeName ? (
					<div className="flex items-baseline gap-1.5">
						<span aria-hidden="true" className="codicon codicon-folder" style={{ fontSize: "12px", opacity: 0.75 }} />
						<span
							data-testid="entry-scope-title"
							style={{ fontSize: "13px", fontWeight: 600, color: "var(--vscode-foreground)" }}>
							{scopeName}
						</span>
					</div>
				) : (
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
				{!isColdStart && (
					<>
						<EnvStrip />
					</>
				)}

				{/* [OPERATOR 2026-09-04] Moved back to the top, on their call. It was below the content
			    because as a bordered card with a lightbulb it out-shouted the resume; now that it is a
			    single quiet line the objection is spent, and one line above the fold is what a
			    dismissible one-time hint is supposed to cost. It sits under the environment group so
			    it reads as chrome rather than as the first suggestion. */}
				<DockCoachMark hasProject={signals.hasWorkspace} />
			</div>

			{/* One block, flowing from the top, with the composer pinned below by the chat layout and a
			    single space between. Two earlier attempts moved that space around — first stranding the
			    content at the top of a screen-high void, then splitting it into a header up here and a
			    cluster down there with a canyon in the middle, which reads as a layout fault. Sparse
			    content in a tall column always leaves space somewhere; the honest place is one gap
			    above the input, not a gap in the middle of the content. */}
			<div className="flex w-full flex-col gap-3">
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
									Nothing has run in <b>{scopeName}</b> yet —{" "}
									<button
										data-testid="entry-elsewhere"
										onClick={openDrawer}
										style={{ color: BRAND_CYAN_TEXT, textDecoration: "underline" }}>
										your {mode.elsewhereCount} session{mode.elsewhereCount > 1 ? "s" : ""} in other folders
									</button>{" "}
									{/* [OPERATOR 2026-09-04] The glyph goes BEFORE the word, because it is the thing
									    being named, not a decoration after it — and this is the only place the copy
									    can teach which control it means. */}
									are in the{" "}
									<span aria-hidden="true" className="codicon codicon-menu" style={{ fontSize: "11px" }} />{" "}
									menu.
								</div>
							)}
						</div>

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
										primary={idx === 0 && anyGrounded && !resumeSession}
										// [F7] Same rule as the drawer: a reason earns its line only when it names
										// something detected. "works on nRF and on ESP32" on three cards in a row
										// was the one thing every card said and the loudest text on each.
										subline={r.grounded ? `◆ ${r.why}` : undefined}
										sublineColor={BRAND_CYAN_TEXT}
										testId={`entry-run-${r.item.id}`}
										title={r.item.title}
									/>
								))}
							</>
						)}
						{/* Cellular & gateways, always present — locked until the developer registers, live after.
						    It sits AFTER the suggested runs because it is a second offer, not a competing one:
						    everything above works today with no account at all, and this group says plainly what
						    a free account adds. Hiding it until sign-in would mean nobody ever learns it exists. */}
						<CellularGroup
							boards={signals.nrfBoards}
							hasBle={signals.features.hasBle}
							onSelectMode={onSelectMode}
							onStartTask={onStartTask}
							platform={platform}
							projectName={projectName}
						/>
					</>
				) : resumeSession ? null : (
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
									onClick={openDrawer}
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
