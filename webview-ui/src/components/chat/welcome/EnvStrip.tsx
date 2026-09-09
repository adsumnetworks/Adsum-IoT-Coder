import { type EspDevice, type EspEnvironment, espUnresolvedDeviceLabel } from "@shared/esp"
import type { NrfBoard, NrfEnvironment } from "@shared/nrf"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"
import { BRAND_WARNING } from "../brandColors"
import { envException } from "./envException"

// ---------------------------------------------------------------------------
// Each platform = a 2-line status row: line 1 = badge + extension · SDK, line 2 =
// detected boards. Rendered as a flat status strip (no card), nRF and ESP identical.
//
// Display (v2): ALWAYS show both platforms. Detection (nrfHasAnything/espHasAnything,
// Omar's classification — unchanged) drives full-vs-dimmed, not hide: an absent platform
// renders as one dimmed "not detected — install …" line (awareness + consistency). The
// badge stays neutral; detected-vs-not is opacity, never colour.
//
// Version line:
//   project + built     → "vX.Y.Z · this build"
//   project, not built  → "not built yet"
//   no project          → "installed" (toolchain present) / "not detected"
// ---------------------------------------------------------------------------

const MUTED = "var(--vscode-descriptionForeground)"
const FG = "var(--vscode-foreground)"
// "There's more on hover" affordance: a small muted ⓘ after the bit that carries a tooltip (the
// extension ✓ build, and the per-build list behind "multiple builds") + a help cursor — no underline,
// and only on the element that actually has info (a "?" next to a version would read as uncertainty).
const HINT_WRAP: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "3px", cursor: "help" }
const INFO_ICON: React.CSSProperties = { fontSize: "10px", opacity: 0.6, color: MUTED }
// Neutral hairline divider between the nRF and ESP rows — foreground-derived so it's grey in every
// theme (some themes tint --vscode-widget-border with an accent).
const NEUTRAL_BORDER = "color-mix(in srgb, var(--vscode-foreground) 15%, transparent)"

interface BlockFacts {
	toolchain: string
	toolchainMuted: boolean
	/** Hover text for the toolchain label — carries the exact extension build (kept out of the line). */
	toolchainTitle?: string
	sdk: string
	sdkTitle?: string
	sdkMuted: boolean
	devices: string
	devicesMuted: boolean
	detecting: boolean
}

interface PlatformRowProps extends BlockFacts {
	/** Platform name shown as the neutral lead badge (nRF / ESP). */
	label: string
	/** True when the platform's toolchain/board/project is present; false → a dimmed "not detected" row. */
	detected: boolean
	/** Muted setup nudge shown when not detected, e.g. "not detected — install ESP-IDF to enable". */
	notDetectedHint: string
}

const FACT_ICON: React.CSSProperties = { fontSize: "12px", color: MUTED, flexShrink: 0 }

/**
 * High-contrast platform badge (nRF / ESP) — the lead identifier on each status row. Inverted vs the
 * theme so it pops: light pill + dark text in dark themes, dark pill + light text (the "reverse") in
 * light themes. Theme-derived (foreground/editor-background) — neutral, never a brand color.
 */
const Badge: React.FC<{ text: string }> = ({ text }) => (
	<span
		style={{
			fontSize: "11px",
			fontWeight: 600,
			letterSpacing: "0.08em",
			color: "var(--vscode-editor-background)",
			background: "var(--vscode-foreground)",
			borderRadius: "4px",
			padding: "1px 5px",
			// Equal-size pills: clamp both nRF/ESP to one width + center, so glyph-width
			// differences ("nRF" vs "ESP") don't make the two badges visibly different sizes.
			minWidth: "34px",
			textAlign: "center",
			boxSizing: "border-box",
			display: "inline-block",
			flexShrink: 0,
		}}>
		{text}
	</span>
)

/** Wraps content in the app's styled (Radix) tooltip when `tip` is set — native `title` does not render
 *  reliably in the VS Code webview, so we use the same Tooltip component as the rest of the app. Renders
 *  the child unchanged when there's no tip. */
const WithTip: React.FC<{ tip?: string; children: React.ReactElement }> = ({ tip, children }) =>
	tip ? (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent>{tip}</TooltipContent>
		</Tooltip>
	) : (
		children
	)

/**
 * Status rows for one platform: line 1 = badge + extension · SDK, line 2 = detected boards/devices
 * (always its own line, for consistency). Reads as a compact status line (not a card). nRF and ESP
 * render identically. Presentation only — the facts are computed upstream by nrfFacts/espFacts.
 */
const PlatformRow: React.FC<PlatformRowProps> = ({
	label,
	detected,
	notDetectedHint,
	toolchain,
	toolchainMuted,
	toolchainTitle,
	sdk,
	sdkTitle,
	sdkMuted,
	devices,
	devicesMuted,
}) => {
	// Not detected → one dimmed line (badge + setup nudge), reusing the inactive-card opacity. The badge
	// stays neutral; detected-vs-not is shown by opacity, not colour (cyan stays "primary action" only).
	if (!detected) {
		return (
			<div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", opacity: 0.55 }}>
				<Badge text={label} />
				<span style={{ color: MUTED }}>{notDetectedHint}</span>
			</div>
		)
	}
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "3px", width: "100%", minWidth: 0 }}>
			{/* Line 1: badge + extension · SDK. Flows naturally — one line when there's room, SDK wraps below
		    on its own only when the panel is too narrow. No truncation; same whether a project is open or closed. */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					flexWrap: "wrap",
					columnGap: "12px",
					rowGap: "3px",
					fontSize: "11px",
				}}>
				<span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: toolchainMuted ? MUTED : FG }}>
					<Badge text={label} />
					<WithTip tip={toolchainTitle}>
						<span style={toolchainTitle ? HINT_WRAP : undefined}>
							{toolchain}
							{toolchainTitle ? <i className="codicon codicon-info" style={INFO_ICON} /> : null}
						</span>
					</WithTip>
				</span>
				<span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: sdkMuted ? MUTED : FG }}>
					<i className="codicon codicon-package" style={FACT_ICON} />
					<WithTip tip={sdkTitle}>
						<span style={sdkTitle ? HINT_WRAP : undefined}>
							{sdk}
							{sdkTitle ? <i className="codicon codicon-info" style={INFO_ICON} /> : null}
						</span>
					</WithTip>
				</span>
			</div>
			{/* Line 2: detected boards / devices — always its own line */}
			<div
				style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: devicesMuted ? MUTED : FG }}>
				<i className="codicon codicon-plug" style={FACT_ICON} />
				<span>{devices}</span>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

const withV = (v: string) => (v.startsWith("v") ? v : `v${v}`)

/** True when there's any nRF signal at all (toolchain, boards, or a project SDK). */
/**
 * One fact, two densities, ONE verdict. The header row (the collapsed environment) and the full
 * view render from this — never from a second computation. [OPERATOR 2026-09-09] The first cut
 * ticked nRF ✓ in the row while the band said "nRF Connect not detected", because the row counted
 * nrfutil as a toolchain and the strip did not. `ready` here IS the strip's toolchain verdict
 * (its un-muted line); `exception` is envException's; boards are the strip's own labels.
 * Mockup: prototypes/environment-two-densities-v2.html.
 */
export interface PlatformVerdict {
	label: "nRF" | "ESP"
	state: "ready" | "missing" | "exception" | "detecting"
	/** The strip's own words for the toolchain line, e.g. "nRF Connect not detected". */
	toolchain: string
	boards: string[]
	exception?: string
}
export function platformVerdicts(
	nrf: NrfEnvironment | undefined,
	esp: EspEnvironment | undefined,
	hasWorkspace: boolean,
): PlatformVerdict[] {
	const out: PlatformVerdict[] = []
	const ex = envException(nrf, esp)
	if (nrf && nrfHasAnything(nrf)) {
		const f = nrfFacts(nrf, hasWorkspace)
		out.push({
			label: "nRF",
			state: ex?.label === "nRF" ? "exception" : f.detecting ? "detecting" : f.toolchainMuted ? "missing" : "ready",
			toolchain: f.toolchain,
			boards: nrfBoardLabels(nrf),
			exception: ex?.label === "nRF" ? ex.text : undefined,
		})
	}
	if (esp && espHasAnything(esp)) {
		const f = espFacts(esp, hasWorkspace)
		out.push({
			label: "ESP",
			state: ex?.label === "ESP" ? "exception" : f.detecting ? "detecting" : f.toolchainMuted ? "missing" : "ready",
			toolchain: f.toolchain,
			boards: espDeviceLabels(esp),
			exception: ex?.label === "ESP" ? ex.text : undefined,
		})
	}
	return out
}

/** The one re-probe, shared by the strip's ↻ and the header row's. */
export function useEnvRefresh(): { refresh: () => void; busy: boolean } {
	const { nrfEnvironment, espEnvironment } = useExtensionState()
	const [refreshing, setRefreshing] = useState(false)
	const refresh = () => {
		if (refreshing) {
			return
		}
		setRefreshing(true)
		FileServiceClient.refreshNrfEnvironment(EmptyRequest.create())
			.catch(() => {})
			.finally(() => setRefreshing(false))
	}
	return { refresh, busy: refreshing || nrfEnvironment?.status === "detecting" || espEnvironment?.status === "detecting" }
}

function nrfHasAnything(env: NrfEnvironment): boolean {
	return env.extensionPresent || env.nrfutilPresent || env.boards.length > 0 || !!env.projectSdk
}

/** Every connected nRF board by name — the strip's rows and the header row read the same list. */
export function nrfBoardLabels(env: NrfEnvironment): string[] {
	if (env.status === "unknown" || env.status === "detecting" || !env.nrfutilPresent) {
		return []
	}
	const labelled = env.boards.map((b: NrfBoard) => {
		// Named host-side from the board-identity bit, so a board Nordic ships between our releases is
		// named by a registry update rather than a reinstall. The webview holds no second table: two
		// copies of one mapping drift, and this one had already acquired two wrong rows. Raw PCA otherwise.
		const friendly = b.boardVersion ? (b.boardName ?? b.boardVersion) : undefined
		// A Nordic USB device with no probe — a dongle — publishes no chip: nrfutil itself answers
		// "not supported for this type of device". Name the CATEGORY, as every other row names a board,
		// plus the only specific identity it does publish: the firmware it is running.
		// This line answers "what boards and DKs are detected" — hardware, not what is running on it.
		// A dongle has no PCA, so its board comes from the board-identity bit, which knows which board
		// Nordic's own firmware images ship for; when the bit cannot name it we say what we do know
		// rather than reporting the firmware string as if it were a model.
		const usbOnly = b.nordicUsb && !b.deviceName && !b.deviceFamily && !b.boardVersion
		const name = usbOnly
			? (b.boardName ?? "Nordic USB device")
			: // [SWEEP 2026-09-09] productName sits before the serial: a board the cards call "nRF52840 DK"
				// was reading as "001050288730" here — same detection, two names for one board.
				(b.deviceName ?? friendly ?? b.productName ?? b.deviceFamily ?? b.serialNumber)
		return { board: b, label: b.boardVersion && b.deviceName ? `${name} (${b.boardVersion})` : name }
	})
	// Two boards of the same kind render identically — the bench has two nRF9161 DKs, both reporting
	// PCA10153 — and the developer then has no way to tell from the strip which one a command will
	// reach. Disambiguate with the tail of the serial, but ONLY where a label actually repeats: a
	// suffix on every board would be noise on the common single-board setup.
	const seen = new Map<string, number>()
	for (const { label } of labelled) {
		seen.set(label, (seen.get(label) ?? 0) + 1)
	}
	return labelled.map(({ board, label }) =>
		(seen.get(label) ?? 0) > 1 && board.serialNumber ? `${label} ·${board.serialNumber.slice(-4)}` : label,
	)
}

function nrfFacts(env: NrfEnvironment, hasWorkspace: boolean): BlockFacts {
	// Extension shown as presence (✓), exact build in the tooltip — the precise version is support-only noise inline.
	const toolchain = env.extensionPresent ? "nRF Connect ✓" : "nRF Connect not detected"
	const toolchainTitle =
		env.extensionPresent && env.extensionVersion ? `nRF Connect for VS Code ${withV(env.extensionVersion)}` : undefined

	// Version line.
	let sdk: string
	let sdkTitle: string | undefined
	let sdkMuted = false
	if (env.projectSdk?.source === "build") {
		const ps = env.projectSdk
		if (ps.allVersions && ps.allVersions.length > 1) {
			// Multiple build configs disagree on NCS; we can't read which is selected → show all (honest).
			sdk = `NCS ${ps.allVersions.map(withV).join(", ")} · multiple builds`
			sdkTitle =
				ps.builds?.map((b) => `${b.dir}: ${withV(b.version)}`).join(" · ") ??
				"Multiple build configs with different NCS versions — see the nRF Connect panel for the selected one"
		} else {
			sdk = `NCS ${withV(ps.version)} · this build`
			sdkTitle = `Resolved from the build artifact (${ps.topology})`
		}
	} else if (env.projectSdk?.source === "manifest") {
		sdk = `NCS ${withV(env.projectSdk.version)} · workspace`
		sdkTitle = `Pinned by the west manifest (${env.projectSdk.topology})`
	} else if (hasWorkspace) {
		sdk = "not built yet"
		sdkMuted = true
	} else if (env.extensionPresent || env.nrfutilPresent) {
		sdk = env.installedSdkVersions?.length
			? `NCS ${env.installedSdkVersions.map(withV).join(", ")} installed`
			: "NCS installed"
	} else {
		sdk = "NCS not detected"
		sdkMuted = true
	}

	let devices: string
	let devicesMuted = false
	if (env.status === "unknown" || env.status === "detecting") {
		devices = "detecting…"
		devicesMuted = true
	} else if (!env.nrfutilPresent) {
		devices = "nrfutil not found"
		devicesMuted = true
	} else if (env.boards.length === 0) {
		devices = "no boards connected"
		devicesMuted = true
	} else {
		devices = nrfBoardLabels(env).join(", ")
	}

	return {
		toolchain,
		toolchainMuted: !env.extensionPresent,
		toolchainTitle,
		sdk,
		sdkTitle,
		sdkMuted,
		devices,
		devicesMuted,
		detecting: env.status === "detecting",
	}
}

/** True when there's any ESP signal at all (toolchain, device, or an ESP project). */
function espHasAnything(env: EspEnvironment): boolean {
	return env.extensionPresent || env.idfPresent || env.espDevices.length > 0 || env.projectDetected
}

/** Every ESP device by name — resolved chip or the honest unresolved label. Shared with the header row. */
export function espDeviceLabels(env: EspEnvironment): string[] {
	if (env.status === "unknown" || env.status === "detecting") {
		return []
	}
	return env.espDevices.map((d: EspDevice) => {
		// This row lists DEVICES, so it stays a list of device names. A second entry that is really
		// one board's other USB interface is folded upstream where that can be PROVEN — same USB
		// serial, or same base MAC — and left alone where it cannot: the only other signal is a
		// shared USB hub, and two separate boards in a desk hub share one too, so folding on it
		// would make a real board vanish. An extra row beats a missing one, and it does not need a
		// sentence of explanation inside a device list to earn its place.
		const name = d.chip ?? espUnresolvedDeviceLabel(d.vid, d.pid)
		return d.chip && d.chipRevision ? `${name} (${d.chipRevision})` : name
	})
}

function espFacts(env: EspEnvironment, hasWorkspace: boolean): BlockFacts {
	// Extension shown as presence (✓), exact build in the tooltip; falls back to SDK-on-disk when the
	// extension is gone but ESP-IDF is still installed (a real state — SDK detection is independent).
	const toolchain = env.extensionPresent ? "Espressif IDF ✓" : env.idfPresent ? "ESP-IDF installed" : "Espressif ext not found"
	const toolchainTitle =
		env.extensionPresent && env.extensionVersion ? `ESP-IDF extension ${withV(env.extensionVersion)}` : undefined

	// Version line. ESP only has a version after a build (project_description.json).
	let sdk: string
	let sdkTitle: string | undefined
	let sdkMuted = false
	if (env.projectIdfVersion && env.projectBuilt) {
		sdk = `ESP-IDF ${withV(env.projectIdfVersion)} · this build`
		sdkTitle = "IDF version from dependencies.lock; build found (project_description.json)"
	} else if (env.projectIdfVersion) {
		// Components resolved (dependencies.lock) but no completed build yet.
		sdk = `ESP-IDF ${withV(env.projectIdfVersion)} · workspace`
		sdkTitle = "Project-bound IDF version from dependencies.lock"
	} else if (env.projectBuilt) {
		// A build exists but no version source was readable — still built.
		sdk = "ESP-IDF · this build"
		sdkTitle = "Build found (project_description.json); IDF version not recorded"
	} else if (hasWorkspace && env.projectDetected) {
		sdk = "not built yet"
		sdkMuted = true
	} else if (env.idfPresent || env.idfVersion || env.installedVersions?.length) {
		// SDK(s) resolved → list ALL installed (like nRF lists NCS), not just installs[0]; otherwise the
		// strip asserts one active version while a build with several installed asks which to use.
		sdk = env.installedVersions?.length
			? `ESP-IDF ${env.installedVersions.map(withV).join(", ")} installed`
			: env.idfVersion
				? `ESP-IDF ${withV(env.idfVersion)} installed`
				: "ESP-IDF installed"
	} else if (env.extensionPresent) {
		// Extension present but no SDK resolved — don't claim ESP-IDF is installed (it isn't yet).
		sdk = "ESP-IDF not installed"
		sdkMuted = true
	} else {
		sdk = "ESP-IDF not detected"
		sdkMuted = true
	}

	let devices: string
	let devicesMuted = false
	if (env.status === "unknown" || env.status === "detecting") {
		devices = "detecting…"
		devicesMuted = true
	} else if (env.espDevices.length === 0) {
		devices = "no boards connected"
		devicesMuted = true
	} else {
		// Show the exact chip once esptool resolved it; otherwise an HONEST unresolved label — "ESP (model
		// unknown)" only for Espressif's own VID, "unidentified serial device" for a generic bridge we never
		// confirmed (never claim "ESP32-family" off an unconfirmed CH34x/CP210x/FTDI device).
		devices = espDeviceLabels(env).join(", ")
	}

	return {
		toolchain,
		toolchainMuted: !env.extensionPresent && !env.idfPresent,
		toolchainTitle,
		sdk,
		sdkTitle,
		sdkMuted,
		devices,
		devicesMuted,
		detecting: env.status === "detecting",
	}
}

// ---------------------------------------------------------------------------
// Combined strip
// ---------------------------------------------------------------------------

/** `forceExpanded`: hosted in the header row's band (2026-09-09), the strip IS the full view — always
 *  open, no "less" of its own; the row closes it. Standalone (tests, older hosts) it keeps A5's
 *  compact-by-default behaviour. */
const EnvStrip: React.FC<{ forceExpanded?: boolean }> = ({ forceExpanded = false }) => {
	const { nrfEnvironment, espEnvironment, openFolderPaths } = useExtensionState()
	const { refresh: handleRefresh, busy: refreshing } = useEnvRefresh()
	// A5 — compact by default (one line per detected platform), expand for the full per-platform detail.
	const [expanded, setExpanded] = useState(forceExpanded)

	const nrfEnv = nrfEnvironment ?? { status: "unknown" as const, extensionPresent: false, nrfutilPresent: false, boards: [] }
	const espEnv = espEnvironment ?? {
		status: "unknown" as const,
		extensionPresent: false,
		idfPresent: false,
		projectDetected: false,
		espDevices: [],
	}

	const hasWorkspace = openFolderPaths.length > 0

	// Always show BOTH platforms (awareness + consistency). Detection drives full-vs-dimmed, not hide —
	// nrfHasAnything/espHasAnything (unchanged) classify "set up"; an absent platform renders dimmed.
	const nrfDetected = nrfHasAnything(nrfEnv)
	const espDetected = espHasAnything(espEnv)

	const nrf = nrfFacts(nrfEnv, hasWorkspace)
	const esp = espFacts(espEnv, hasWorkspace)

	const containerStyle: React.CSSProperties = {
		display: "flex",
		flexDirection: "row",
		alignItems: "flex-start",
		gap: "8px",
		width: "100%",
		// True flat status strip — no background panel, border, or radius, so it reads as a status line
		// under the project name, not a card (distinct from the bordered action cards and dashed
		// coming-soon cards). Flush-left to align with the project name above.
		padding: "2px 0",
	}

	// One refresh re-probes both (same handleRefresh + detecting/refreshing state).
	const refreshBusy = refreshing || nrf.detecting || esp.detecting

	// Compact summary line per detected platform (A5). Collapsed is fixed-height, so detecting→ready fills in
	// place rather than reflowing the rows (A2).
	const compact = (f: BlockFacts): string => [f.sdk, f.devicesMuted ? null : f.devices].filter(Boolean).join(" · ")
	const summaryRows: Array<{ label: string; text: string }> = []
	if (nrfDetected) {
		summaryRows.push({ label: "nRF", text: compact(nrf) })
	}
	if (espDetected) {
		summaryRows.push({ label: "ESP", text: compact(esp) })
	}
	const detecting = nrf.detecting || esp.detecting
	// The one thing worth interrupting for, or nothing. See envException.ts for why "no boards
	// connected" deliberately does not qualify.
	const exception = envException(nrfEnvironment, espEnvironment)

	const collapseLinkStyle: React.CSSProperties = {
		display: "inline-flex",
		alignItems: "center",
		gap: "4px",
		alignSelf: "flex-start",
		background: "none",
		border: "none",
		padding: 0,
		marginTop: "2px",
		color: MUTED,
		opacity: 0.7,
		fontSize: "10px",
		cursor: "pointer",
	}

	return (
		<div style={containerStyle}>
			<div id="envstrip-detail" style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
				{expanded ? (
					<>
						<PlatformRow
							detected={nrfDetected}
							label="nRF"
							notDetectedHint="not detected — install nRF Connect SDK to enable"
							{...nrf}
						/>
						<div style={{ height: "1px", background: NEUTRAL_BORDER, width: "100%" }} />
						<PlatformRow
							detected={espDetected}
							label="ESP"
							notDetectedHint="not detected — install ESP-IDF to enable"
							{...esp}
						/>
						{!forceExpanded && (
							<button
								aria-controls="envstrip-detail"
								aria-expanded={expanded}
								aria-label="Hide environment detail"
								data-testid="envstrip-collapse"
								onClick={() => setExpanded(false)}
								style={collapseLinkStyle}
								type="button">
								<i className="codicon codicon-chevron-up" style={{ fontSize: "11px" }} /> less
							</button>
						)}
					</>
				) : (
					<button
						aria-controls="envstrip-detail"
						aria-expanded={expanded}
						aria-label="Show environment detail"
						data-testid="envstrip-summary"
						onClick={() => setExpanded(true)}
						style={{
							display: "flex",
							// flex-start, not center. [OPERATOR 2026-09-04] With two rows in the strip the
							// chevron centred itself between them while the rescan button beside it pinned
							// to the top — two controls on one row sitting at two different heights, which
							// is what made the block read as unaligned. Both now hang off the first row.
							alignItems: "flex-start",
							gap: "8px",
							width: "100%",
							background: "none",
							border: "none",
							padding: 0,
							cursor: "pointer",
							textAlign: "left",
						}}
						title="Show environment detail"
						type="button">
						<div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
							{exception ? (
								<span
									data-testid="envstrip-exception"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: "6px",
										fontSize: "11px",
										minWidth: 0,
									}}>
									<Badge text={exception.label} />
									{/* Semantic colour, status only — the golden rules allow it here precisely because
									    this is a state of the machine, not a judgement about the developer's work. */}
									<span
										style={{
											color: BRAND_WARNING,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}>
										{exception.text}
									</span>
								</span>
							) : summaryRows.length > 0 ? (
								summaryRows.map((r) => (
									<span
										key={r.label}
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: "6px",
											fontSize: "11px",
											minWidth: 0,
										}}>
										<Badge text={r.label} />
										<span
											style={{
												color: MUTED,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}>
											{r.text}
										</span>
									</span>
								))
							) : (
								<span style={{ color: MUTED, fontSize: "11px" }}>
									{/* [SWEEP 2026-09-04, F10] "click to set up" promised an action the click
									    does not perform — it expands the detail, where the setup links live.
									    Say what the click does. */}
									{detecting ? "detecting…" : "No SDK detected — details"}
								</span>
							)}
						</div>
						<i
							className="codicon codicon-chevron-right"
							style={{ fontSize: "11px", color: MUTED, flexShrink: 0, marginTop: "2px" }}
						/>
					</button>
				)}
			</div>
			<button
				aria-label="Re-probe detected platforms"
				disabled={refreshBusy}
				onClick={handleRefresh}
				style={{
					background: "none",
					border: "none",
					cursor: refreshBusy ? "default" : "pointer",
					padding: "0",
					marginTop: "1px",
					color: MUTED,
					opacity: refreshBusy ? 0.5 : 0.7,
					display: "inline-flex",
					alignItems: "center",
					flexShrink: 0,
				}}
				title="Re-probe detected platforms"
				type="button">
				<i
					className={`codicon codicon-refresh${refreshBusy ? " codicon-modifier-spin" : ""}`}
					style={{ fontSize: "12px" }}
				/>
			</button>
		</div>
	)
}

export default EnvStrip
