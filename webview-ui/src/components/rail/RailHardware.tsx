import type { EspEnvironment } from "@shared/esp"
import type React from "react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { espDeviceLabels, nrfBoardLabels, useEnvRefresh } from "../chat/welcome/EnvStrip"
import Info from "../common/Info"
import { R } from "./railStyles"
import { Chevron, useSectionOpen } from "./useSectionOpen"

interface Props {
	/** A unit or board row opens the Hardware page. */
	onOpen: (board: string) => void
}

/**
 * [0.5 sessions first] What is on the desk, by name: the units and boards, the toolchains with their
 * versions, the folder. Absent things are dim, never hidden. A unit row opens the Hardware page.
 */
const RailHardware: React.FC<Props> = ({ onOpen }) => {
	const { nrfEnvironment, espEnvironment, openFolderPaths, openSessions } = useExtensionState()
	const { refresh, busy } = useEnvRefresh()
	const [shown, toggleShown] = useSectionOpen("hardware")
	const [open, setOpen] = useState(true)
	const nrfEnv = nrfEnvironment ?? { status: "unknown" as const, extensionPresent: false, nrfutilPresent: false, boards: [] }
	const espEnv = (espEnvironment ?? {
		status: "unknown" as const,
		extensionPresent: false,
		idfPresent: false,
		espDevices: [],
	}) as EspEnvironment
	const nrf = nrfBoardLabels(nrfEnv)
	const esp = espDeviceLabels(espEnv)
	const roots = openFolderPaths ?? []
	const folder = roots[0]?.split("/").pop()
	const nrfOk = !!(nrfEnv.extensionPresent || nrfEnv.nrfutilPresent)
	const espOk = !!(espEnv.extensionPresent || espEnv.idfPresent)
	const nrfVersion = (nrfEnv as { projectSdk?: { version?: string }; installedSdkVersions?: string[] }).projectSdk?.version
	const streaming = (openSessions ?? []).find((s) => s.streaming)

	const Row: React.FC<{ pf: string; dim?: boolean; children: React.ReactNode; onClick?: () => void; title?: string }> = ({
		pf,
		dim,
		children,
		onClick,
		title,
	}) => {
		const inner = (
			<>
				<span style={R.pf}>{pf}</span>
				<span
					style={{
						...R.body,
						fontSize: 11.5,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						minWidth: 0,
					}}>
					{children}
				</span>
			</>
		)
		const style = { display: "flex", alignItems: "center", gap: 7, opacity: dim ? 0.55 : 1, minWidth: 0 }
		return onClick ? (
			<button
				onClick={onClick}
				style={{
					...style,
					background: "none",
					border: 0,
					padding: "2px 0",
					cursor: "pointer",
					font: "inherit",
					width: "100%",
					textAlign: "left",
				}}
				title={title}
				type="button">
				{inner}
			</button>
		) : (
			<div style={style} title={title}>
				{inner}
			</div>
		)
	}

	return (
		<div data-testid="rail-hardware" style={R.block}>
			<div style={R.blockHead}>
				<button aria-expanded={shown} onClick={toggleShown} style={R.sectionToggle} type="button">
					<Chevron open={shown} />
					<span style={R.label}>Hardware</span>
				</button>
				<span style={{ display: "flex", gap: 8 }}>
					<button aria-expanded={open} onClick={() => setOpen((v) => !v)} style={R.link} type="button">
						{open ? "less" : "more"}
					</button>
					<button disabled={busy} onClick={refresh} style={R.link} title="Re-probe detected platforms" type="button">
						↻
					</button>
				</span>
			</div>
			{shown && (
				<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
					{nrf.map((b) => (
						<Row key={`nrf-${b}`} onClick={() => onOpen(b)} pf="nRF" title={`${b} · opens the Hardware page`}>
							<b style={{ fontWeight: 600 }}>{b}</b>
							{streaming ? (
								<span style={{ color: "var(--adsum-cyan-text)" }}>
									{" "}
									· in use by {streaming.title || "a session"}
								</span>
							) : null}
						</Row>
					))}
					{esp.map((d) => (
						<Row key={`esp-${d}`} onClick={() => onOpen(d)} pf="ESP" title={`${d} · opens the Hardware page`}>
							<b style={{ fontWeight: 600 }}>{d}</b>
						</Row>
					))}
					{nrf.length + esp.length === 0 && (
						<Row dim pf="USB">
							nothing connected
						</Row>
					)}
					{open && (
						<>
							<Row dim={!nrfOk} pf="nRF">
								{nrfOk ? `nRF Connect SDK${nrfVersion ? ` v${nrfVersion}` : ""}` : "nRF Connect SDK"}
								{!nrfOk && (
									<>
										{" "}
										<Info text="Not found. Install the nRF Connect SDK and its VS Code extension; the agent builds and flashes nRF boards through them." />
									</>
								)}
							</Row>
							<Row dim={!espOk} pf="ESP">
								{espOk ? "ESP-IDF" : "ESP-IDF"}
								{!espOk && (
									<>
										{" "}
										<Info text="Not found. Install ESP-IDF (the Espressif IDF extension is the easy way); the agent builds and flashes ESP32 boards through it." />
									</>
								)}
							</Row>
							<Row dim={!folder} pf="DIR">
								{folder ?? "no folder open"}
							</Row>
						</>
					)}
				</div>
			)}
		</div>
	)
}

export default RailHardware
