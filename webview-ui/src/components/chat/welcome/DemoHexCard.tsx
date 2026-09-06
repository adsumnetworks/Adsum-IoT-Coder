import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, BRAND_CYAN_UI, brandAlpha } from "../brandColors"

/**
 * Flash the LEW840x demo — the first thing a newly-registered developer can actually run.
 *
 * Coral frame, because this is the identity moment: our hardware partner's board, our signed builds.
 * It is the only card on this surface that puts bytes on a device, so it is the only one that earns
 * a coloured edge here.
 *
 * The copy states the two limits up front rather than after the download: the cellular bearer is
 * capped at 60-minute sessions (Wi-Fi and Ethernet are not), and flashing needs nrfutil and esptool
 * on this machine. A demo whose limits are discovered afterwards is a demo that gets returned.
 */

interface DemoHexCardProps {
	onFlash: () => void | Promise<void>
	/** Which of the three is being written, e.g. "nRF9160 bearer… 2 of 3". Absent ⇒ idle. */
	flashing?: string
}

const DemoHexCard: React.FC<DemoHexCardProps> = ({ onFlash, flashing }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const [busy, setBusy] = useState(false)
	if (!accountHasGroup(adsumAccount, "lew840x-demo-hex")) {
		return null
	}
	const state = flashing ?? (busy ? "Starting…" : undefined)
	return (
		<div
			data-testid="demo-hex-card"
			style={{
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.55)}`,
				background: "var(--vscode-input-background)",
				borderRadius: "10px",
				padding: "12px 14px",
			}}>
			<div style={{ fontSize: "13px", fontWeight: 600, color: "var(--vscode-foreground)", marginBottom: "5px" }}>
				<i className="codicon codicon-rocket" style={{ fontSize: "12px", color: BRAND_CORAL, marginRight: "6px" }} />
				Flash the LEW840x demo
			</div>
			<div style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" }}>
				Three signed hexes: BLE scanner, ESP32 uplink, nRF9160 bearer. Wi-Fi and Ethernet unlimited; cellular in 60-minute
				sessions, for evaluation. Needs nrfutil and esptool on this machine.
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
				{state ? (
					<span
						data-testid="demo-hex-flashing"
						style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
						Flashing {state}
					</span>
				) : (
					<>
						<button
							data-testid="demo-hex-flash"
							onClick={() => {
								setBusy(true)
								void Promise.resolve(onFlash()).finally(() => setBusy(false))
							}}
							style={{
								padding: "5px 12px",
								borderRadius: "6px",
								fontSize: "12px",
								fontWeight: 600,
								cursor: "pointer",
								// Cyan, not coral: the frame carries the identity, the button carries the action,
								// and the surface has exactly one meaning per colour.
								border: `1px solid ${BRAND_CYAN_UI}`,
								background: BRAND_CYAN_UI,
								color: "#04222b",
							}}
							type="button">
							Flash demo ▸
						</button>
						<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
							≈ 3 min · you will be asked for the ports
						</span>
					</>
				)}
			</div>
		</div>
	)
}

export default DemoHexCard
