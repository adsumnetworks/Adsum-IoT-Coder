import { blg20BleUnitRoute, blg20OverBluetooth, confirmedBlg20Units } from "@shared/blg20"
import type React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import EnvStrip from "../chat/welcome/EnvStrip"
import GatewayLadder from "../chat/welcome/GatewayLadder"
import { useEntrySignals } from "../chat/welcome/useEntrySignals"
import { blg20InstallPrompt, blg20SetUpPrompt, buildIntentPrompt } from "../chat/welcome/welcomeIntents"
import FirmwareRungs from "./FirmwareRungs"
import { R } from "./railStyles"
import { bleSetUpPrompt, unitActions } from "./unitActions"

interface Props {
	/** The family to show, when a row asked for one ("Flash the LEW840x demo"); else the desk decides. */
	family?: string
	onBack: () => void
	/** No account yet: the free registration opens the demo rungs. */
	onRegister: () => void
	/** Starts a session with a prompt; `send` sends it as the first message, else it fills the box. */
	onPrompt: (prompt: string, send: boolean) => void
	onAsk: (family: "blg20" | "lew840x") => void
}

/**
 * [0.5 sessions first] The Hardware page of the sidebar: everything on the desk in full, then the BLG20x
 * ladder with one action per rung (the free path, the demo, production, source, built for you). The
 * version rows and the firmware states arrive with the firmware lane.
 */
const HardwarePage: React.FC<Props> = ({ family: asked, onBack, onPrompt, onAsk, onRegister }) => {
	const { signals, scopeName } = useEntrySignals()
	const { nrfEnvironment } = useExtensionState()
	const boards = [...signals.nrfBoards, ...signals.espDevices]
	// The firmware family: the one a row asked for, else the unit on the desk (the LBG20x shares the port,
	// the tool and this page), else what the open project is about, else every family.
	const family =
		asked ??
		confirmedBlg20Units(nrfEnvironment?.blg20Units)[0]?.family ??
		(signals.product === "lew840x" ? "lew840x" : signals.product === "blg20" ? "blg20x" : undefined)
	const gatewayLadder = family === undefined || family === "blg20x" || family === "lbg20x"
	// [10 Oct 2026] The unit on the desk: over Bluetooth only (the LBG20x), its Flash goes over Bluetooth and its
	// set-up journey says so; on either door it gets its own three actions beside Set it up.
	const unit = confirmedBlg20Units(nrfEnvironment?.blg20Units)[0]
	const bleUnit = unit && blg20OverBluetooth(unit) ? unit : undefined
	return (
		<div data-testid="rail-hardware-page" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<div style={R.blockHead}>
				<span style={R.headline}>Hardware</span>
				<button onClick={onBack} style={R.link} type="button">
					← back
				</button>
			</div>
			<EnvStrip forceExpanded />
			<FirmwareRungs
				family={family}
				onAsk={() => onAsk(family === "lew840x" ? "lew840x" : "blg20")}
				onFlash={(prompt) => onPrompt(prompt, true)}
				onRegister={onRegister}
				// Renewal is a request to the team for now: money never moves in the editor, and there is no web
				// store to send anyone to yet.
				onRenew={() => onAsk(family === "lew840x" ? "lew840x" : "blg20")}
				unitDoor={bleUnit ? "over Bluetooth" : undefined}
				unitRoute={bleUnit ? (folder: string) => blg20BleUnitRoute(bleUnit, folder) : undefined}
			/>
			{gatewayLadder && (
				<GatewayLadder
					boards={boards}
					chips={signals.nrfChips ?? []}
					demoViaFirmware
					onAsk={() => onAsk("blg20")}
					onInstall={(way) => onPrompt(blg20InstallPrompt(way), false)}
					onSetUp={(board) => onPrompt(bleUnit ? bleSetUpPrompt(bleUnit) : blg20SetUpPrompt(board), true)}
					onStart={() => onPrompt(buildIntentPrompt("blg20Gateway", scopeName || undefined, "nrf", false), false)}
					unitActions={
						unit ? unitActions(unit).map((a) => ({ ...a, onClick: () => onPrompt(a.prompt, true) })) : undefined
					}
				/>
			)}
		</div>
	)
}

export default HardwarePage
