import type { EspDevice, EspEnvironment } from "@shared/esp"
import type { NrfBoard, NrfEnvironment } from "@shared/nrf"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"

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
			fontWeight: 700,
			letterSpacing: "0.04em",
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

const PCA_NAMES: Record<string, string> = {
	PCA10028: "nRF51 DK",
	PCA10031: "nRF51 Dongle",
	PCA10040: "nRF52832 DK",
	PCA10056: "nRF52840 DK",
	PCA10059: "nRF52840 Dongle",
	PCA10090: "nRF9160 DK",
	PCA10095: "nRF5340 DK",
	PCA10100: "nRF5340 DK",
	PCA10153: "nRF9161 DK",
	PCA20020: "Thingy:52",
	PCA20035: "Thingy:91",
}

/** True when there's any nRF signal at all (toolchain, boards, or a project SDK). */
function nrfHasAnything(env: NrfEnvironment): boolean {
	return env.extensionPresent || env.nrfutilPresent || env.boards.length > 0 || !!env.projectSdk
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
		devices = env.boards
			.map((b: NrfBoard) => {
				const friendly = b.boardVersion ? (PCA_NAMES[b.boardVersion] ?? b.boardVersion) : undefined
				const name = b.deviceName ?? friendly ?? b.deviceFamily ?? b.serialNumber
				return b.boardVersion && b.deviceName ? `${name} (${b.boardVersion})` : name
			})
			.join(", ")
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
		// Show the exact chip once esptool resolved it; otherwise "ESP32-family".
		devices = env.espDevices
			.map((d: EspDevice) => {
				const name = d.chip ?? "ESP32-family"
				return d.chip && d.chipRevision ? `${name} (${d.chipRevision})` : name
			})
			.join(", ")
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

const EnvStrip: React.FC = () => {
	const { nrfEnvironment, espEnvironment, openFolderPaths } = useExtensionState()
	const [refreshing, setRefreshing] = useState(false)
	// A5 — compact by default (one line per detected platform), expand for the full per-platform detail.
	const [expanded, setExpanded] = useState(false)

	const handleRefresh = () => {
		if (refreshing) return
		setRefreshing(true)
		FileServiceClient.refreshNrfEnvironment(EmptyRequest.create())
			.catch(() => {})
			.finally(() => setRefreshing(false))
	}

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
			<div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
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
						<button
							data-testid="envstrip-collapse"
							onClick={() => setExpanded(false)}
							style={collapseLinkStyle}
							type="button">
							<i className="codicon codicon-chevron-up" style={{ fontSize: "11px" }} /> less
						</button>
					</>
				) : (
					<button
						data-testid="envstrip-summary"
						onClick={() => setExpanded(true)}
						style={{
							display: "flex",
							alignItems: "center",
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
							{summaryRows.length > 0 ? (
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
									{detecting ? "detecting…" : "No SDK detected — click to set up"}
								</span>
							)}
						</div>
						<i className="codicon codicon-chevron-right" style={{ fontSize: "11px", color: MUTED, flexShrink: 0 }} />
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
