import type { AdsumAccountState } from "@shared/adsumAccount"
import { StringRequest } from "@shared/proto/cline/common"
import type React from "react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"
import FirstSteps from "./FirstSteps"
import WhatsNewCard from "./WhatsNewCard"
import GatePanel from "./welcome/GatePanel"
import { useEntrySignals } from "./welcome/useEntrySignals"

const T = {
	label: {
		fontSize: 10,
		letterSpacing: ".08em",
		textTransform: "uppercase" as const,
		color: "var(--vscode-descriptionForeground)",
	},
	body: { fontSize: 12.5, lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" },
}

/** The two prefill prompts First steps shares with the EmptySession rows it replaced — same text,
 *  same contract: Enter sends it, never fired on click. */
const BUILD_PROMPT =
	"Build, flash and debug this project: build it, flash the connected board, then stream the live logs and watch for faults."
const GATEWAY_PROMPT =
	"Start the BLG20x first run: the plan and the parts to have on the desk, identify the board from its probes, flash the prebuilt pair, commission it, and bring the first reading to my tenant."
const SAMPLE_PROMPT = "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]"

/**
 * [0.5 sessions first] What a new session tab shows before its first message. The cards live in the
 * sidebar's palette; here, while `entryMode()` says the developer is new to this folder (fewer than two
 * sessions, none in 30 days, or none here), the First steps ladder and the What's new card sit under the
 * "Say what you want done" line. After that the placeholder stands alone.
 */
const EmptySession: React.FC<{ onStartTask: (text: string) => void | Promise<void>; onPrefill: (text: string) => void }> = ({
	onStartTask,
	onPrefill,
}) => {
	const { mode, scopeName, roots } = useEntrySignals()
	const { taskHistory, adsumAccount } = useExtensionState() as ReturnType<typeof useExtensionState> & {
		adsumAccount?: AdsumAccountState
	}
	const expanded = mode.mode === "expanded"
	const [registerOpen, setRegisterOpen] = useState(false)

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: "12px 14px",
				marginTop: "auto",
				marginBottom: "auto",
			}}>
			<div style={T.label}>{scopeName ? `New session · ${scopeName}` : "New session"}</div>
			<div style={T.body}>Say what you want done, then Enter.</div>
			{expanded && (
				<FirstSteps
					onOpenProject={() => void FileServiceClient.openFolder(StringRequest.create({ value: "" }))}
					onPrefillBuild={() => onPrefill(BUILD_PROMPT)}
					onPrefillGateway={() => onPrefill(GATEWAY_PROMPT)}
					onRegister={() => setRegisterOpen(true)}
					onRunSample={() => void onStartTask(SAMPLE_PROMPT)}
					state={{ adsumAccount, openFolderPaths: roots, taskHistory }}
				/>
			)}
			<WhatsNewCard />
			<GatePanel onClose={() => setRegisterOpen(false)} open={registerOpen} surface="first-steps" />
		</div>
	)
}

export default EmptySession
