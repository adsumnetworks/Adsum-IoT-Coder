import type { EspDevice, EspEnvironment } from "@shared/esp"
import type { NrfBoard, NrfEnvironment } from "@shared/nrf"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"

// ---------------------------------------------------------------------------
// One detected platform = a 2-line status row: line 1 = badge + extension · SDK,
// line 2 = detected boards. Rendered as a flat status strip (no card), nRF and
// ESP identical so they read the same way.
//
// Show/hide (per Omar, 2026-06-12):
//   no project open  → show both (only the platforms that have something)
//   nRF project      → nRF only
//   ESP project      → ESP only
//   mixed workspace  → both
//
// Version line:
//   project + built     → "vX.Y.Z · this build"
//   project, not built  → "not built yet"
//   no project          → "installed" (toolchain present) / "not detected"
// ---------------------------------------------------------------------------

const MUTED = "var(--vscode-descriptionForeground)"
const FG = "var(--vscode-foreground)"
// Neutral hairline divider between the nRF and ESP rows — foreground-derived so it's grey in every
// theme (some themes tint --vscode-widget-border with an accent).
const NEUTRAL_BORDER = "color-mix(in srgb, var(--vscode-foreground) 15%, transparent)"

interface BlockFacts {
	toolchain: string
	toolchainMuted: boolean
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
			background: "color-mix(in srgb, var(--vscode-foreground) 80%, transparent)",
			borderRadius: "4px",
			padding: "2px 6px",
			flexShrink: 0,
		}}>
		{text}
	</span>
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
					<span>{toolchain}</span>
				</span>
				<span
					style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: sdkMuted ? MUTED : FG }}
					title={sdkTitle}>
					<i className="codicon codicon-package" style={FACT_ICON} />
					<span>{sdk}</span>
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
	const toolchain = env.extensionPresent ? `nRF Connect ext ${withV(env.extensionVersion ?? "?")}` : "nRF Connect not detected"

	// Version line.
	let sdk: string
	let sdkTitle: string | undefined
	let sdkMuted = false
	if (env.projectSdk?.source === "build") {
		sdk = `NCS ${withV(env.projectSdk.version)} · this build`
		sdkTitle = `Resolved from the build artifact (${env.projectSdk.topology})`
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
	const toolchain = env.extensionPresent
		? `Espressif IDF ext ${withV(env.extensionVersion ?? "?")}`
		: env.idfPresent
			? "ESP-IDF installed"
			: "Espressif ext not found"

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
	} else if (env.extensionPresent || env.idfPresent) {
		// Installed-but-no-project: show the machine-installed IDF version (version.txt) like nRF shows NCS.
		sdk = env.idfVersion ? `ESP-IDF ${withV(env.idfVersion)} installed` : "ESP-IDF installed"
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

	return (
		<div style={containerStyle}>
			<div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
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
