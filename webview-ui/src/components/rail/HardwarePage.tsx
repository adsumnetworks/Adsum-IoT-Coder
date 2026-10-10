import type React from "react"
import EnvStrip from "../chat/welcome/EnvStrip"
import GatewayLadder from "../chat/welcome/GatewayLadder"
import { useEntrySignals } from "../chat/welcome/useEntrySignals"
import { blg20InstallPrompt, blg20SetUpPrompt, buildIntentPrompt } from "../chat/welcome/welcomeIntents"
import { R } from "./railStyles"

interface Props {
	onBack: () => void
	/** Starts a session with a prompt; `send` sends it as the first message, else it fills the box. */
	onPrompt: (prompt: string, send: boolean) => void
	onAsk: (family: "blg20" | "lew840x") => void
}

/**
 * [0.5 sessions first] The Hardware page of the sidebar: everything on the desk in full, then the BLG20x
 * ladder with one action per rung (the free path, the demo, production, source, built for you). The
 * version rows and the firmware states arrive with the firmware lane.
 */
const HardwarePage: React.FC<Props> = ({ onBack, onPrompt, onAsk }) => {
	const { signals, scopeName } = useEntrySignals()
	const boards = [...signals.nrfBoards, ...signals.espDevices]
	return (
		<div data-testid="rail-hardware-page" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<div style={R.blockHead}>
				<span style={R.headline}>Hardware</span>
				<button onClick={onBack} style={R.link} type="button">
					← back
				</button>
			</div>
			<EnvStrip forceExpanded />
			<GatewayLadder
				boards={boards}
				chips={signals.nrfChips ?? []}
				onAsk={() => onAsk("blg20")}
				onInstall={(way) => onPrompt(blg20InstallPrompt(way), false)}
				onSetUp={(board) => onPrompt(blg20SetUpPrompt(board), true)}
				onStart={() => onPrompt(buildIntentPrompt("blg20Gateway", scopeName || undefined, "nrf", false), false)}
			/>
		</div>
	)
}

export default HardwarePage
