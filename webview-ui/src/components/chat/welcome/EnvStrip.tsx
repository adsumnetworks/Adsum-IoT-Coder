import type { EspDevice, EspEnvironment } from "@shared/esp"
import type { NrfBoard, NrfEnvironment } from "@shared/nrf"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"
import { BRAND_CORAL, BRAND_CYAN_600 } from "../brandColors"

// ---------------------------------------------------------------------------
// One detected platform = a 3-line block (extension / SDK / devices). nRF and
// ESP share the identical structure so they read the same way.
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

interface PlatformBlockProps extends BlockFacts {
	badge: string
	badgeColor: string
	onRefresh: () => void
	refreshing: boolean
	refreshLabel: string
}

const PlatformBlock: React.FC<PlatformBlockProps> = ({
	badge,
	badgeColor,
	toolchain,
	toolchainMuted,
	sdk,
	sdkTitle,
	sdkMuted,
	devices,
	devicesMuted,
	onRefresh,
	refreshing,
	refreshLabel,
}) => (
	<div style={{ display: "flex", flexDirection: "column", gap: "3px", width: "100%" }}>
		{/* Header: badge + extension/toolchain + refresh (refresh pinned right, never wraps) */}
		<div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
			<span
				style={{
					fontSize: "9px",
					fontWeight: 700,
					letterSpacing: "0.04em",
					color: "#fff",
					background: badgeColor,
					borderRadius: "4px",
					padding: "1px 5px",
					flexShrink: 0,
				}}>
				{badge}
			</span>
			<span
				style={{
					fontSize: "11px",
					color: toolchainMuted ? MUTED : FG,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}>
				{toolchain}
			</span>
			<button
				aria-label={refreshLabel}
				disabled={refreshing}
				onClick={onRefresh}
				style={{
					marginLeft: "auto",
					background: "none",
					border: "none",
					cursor: refreshing ? "default" : "pointer",
					padding: "0",
					color: MUTED,
					opacity: refreshing ? 0.5 : 0.7,
					display: "inline-flex",
					alignItems: "center",
					flexShrink: 0,
				}}
				title={refreshLabel}
				type="button">
				<i
					className={`codicon codicon-refresh${refreshing ? " codicon-modifier-spin" : ""}`}
					style={{ fontSize: "12px" }}
				/>
			</button>
		</div>

		{/* SDK / framework line */}
		<div
			style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: sdkMuted ? MUTED : FG }}
			title={sdkTitle}>
			<i className="codicon codicon-package" style={{ fontSize: "12px", color: MUTED, flexShrink: 0 }} />
			<span>{sdk}</span>
		</div>

		{/* Devices line */}
		<div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: devicesMuted ? MUTED : FG }}>
			<i className="codicon codicon-plug" style={{ fontSize: "12px", color: MUTED, flexShrink: 0 }} />
			<span>{devices}</span>
		</div>
	</div>
)

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
		sdk = "ESP-IDF installed"
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
		devices = "no ESP devices"
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
	const { nrfEnvironment, espEnvironment, openFolderPaths, workspaceClassification } = useExtensionState()
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
	const cls = workspaceClassification ?? "none"

	// Show/hide rule: nRF project → nRF only; ESP project → ESP only; otherwise both.
	// Then gate each section on actually having something, so a single-platform
	// machine never shows an empty section for the other platform.
	const nrfAllowed = !hasWorkspace || cls === "nrf" || cls === "both" || cls === "none"
	const espAllowed = !hasWorkspace || cls === "esp" || cls === "both" || cls === "none"
	const showNrf = nrfAllowed && nrfHasAnything(nrfEnv)
	const showEsp = espAllowed && espHasAnything(espEnv)

	const nrf = nrfFacts(nrfEnv, hasWorkspace)
	const esp = espFacts(espEnv, hasWorkspace)

	const containerStyle: React.CSSProperties = {
		display: "flex",
		flexDirection: "column",
		gap: "8px",
		width: "100%",
		border: "1px solid var(--vscode-widget-border)",
		borderRadius: "8px",
		padding: "9px 11px",
		background: "color-mix(in srgb, var(--vscode-foreground) 3%, transparent)",
	}

	if (!showNrf && !showEsp) {
		return <div style={{ ...containerStyle, fontSize: "11px", color: MUTED }}>No nRF or ESP toolchain detected.</div>
	}

	return (
		<div style={containerStyle}>
			{showNrf && (
				<PlatformBlock
					badge="nRF"
					badgeColor={BRAND_CYAN_600}
					onRefresh={handleRefresh}
					refreshing={nrf.detecting || refreshing}
					refreshLabel="Re-probe nRF Connect + connected boards"
					{...nrf}
				/>
			)}

			{showNrf && showEsp && <div style={{ height: "1px", background: "var(--vscode-widget-border)", width: "100%" }} />}

			{showEsp && (
				<PlatformBlock
					badge="ESP"
					badgeColor={BRAND_CORAL}
					onRefresh={handleRefresh}
					refreshing={esp.detecting || refreshing}
					refreshLabel="Re-probe ESP-IDF + connected ESP devices"
					{...esp}
				/>
			)}
		</div>
	)
}

export default EnvStrip
