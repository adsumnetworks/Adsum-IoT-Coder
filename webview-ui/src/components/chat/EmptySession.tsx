import type React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Info from "../common/Info"
import { BRAND_CORAL, BRAND_CYAN_UI } from "./brandColors"
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

interface Row {
	id: string
	title: string
	blurb: string
	/** A sample runs on click (pre-canned, safe); a run fills the box and waits for Enter. */
	kind: "sample" | "prefill"
	prompt: string
	focal?: boolean
}

/**
 * [0.5 sessions first] What a new session tab shows before its first message. The cards live in the
 * sidebar's palette; here there are at most three quiet rows, and only while `entryMode()` says the
 * developer is new to this folder (fewer than two sessions, none in 30 days, or none here). After that
 * the placeholder stands alone. One sample runs on click; the two runs fill the box and wait.
 */
const EmptySession: React.FC<{ onStartTask: (text: string) => void | Promise<void>; onPrefill: (text: string) => void }> = ({
	onStartTask,
	onPrefill,
}) => {
	const { mode, scopeName, signals } = useEntrySignals()
	const { taskHistory } = useExtensionState()
	const expanded = mode.mode === "expanded"
	const hasBoard = signals.nrfBoards.length + signals.espDevices.length > 0
	const rows: Row[] = [
		{
			id: "sample",
			title: "Sample debug session",
			blurb: "A real BLE bug on real nRF source · about a minute · nothing to install",
			kind: "sample",
			prompt: "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]",
			focal: !hasBoard && (taskHistory?.length ?? 0) === 0,
		},
		{
			id: "build",
			title: "Build, flash and debug",
			blurb: "Build, flash and stream live logs",
			kind: "prefill",
			prompt: "Build, flash and debug this project: build it, flash the connected board, then stream the live logs and watch for faults.",
		},
		{
			id: "blg20",
			title: "BLG20x first run",
			blurb: "Plan, parts, identify, flash the pair, commission, first reading · 7 steps",
			kind: "prefill",
			prompt: "Start the BLG20x first run: the plan and the parts to have on the desk, identify the board from its probes, flash the prebuilt pair, commission it, and bring the first reading to my tenant.",
		},
	]
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
			<div style={T.body}>Say what you want done, then Enter.{expanded ? " Or pick one:" : ""}</div>
			{expanded && (
				<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
					{rows.map((r) => (
						<button
							key={r.id}
							onClick={() => (r.kind === "sample" ? void onStartTask(r.prompt) : onPrefill(r.prompt))}
							style={{
								display: "flex",
								gap: 8,
								alignItems: "center",
								textAlign: "left",
								padding: "5px 8px",
								borderRadius: 6,
								border: `1px solid ${r.focal ? BRAND_CYAN_UI : "transparent"}`,
								background: r.focal ? `color-mix(in srgb, ${BRAND_CYAN_UI} 8%, transparent)` : "none",
								color: "var(--vscode-foreground)",
								cursor: "pointer",
								font: "inherit",
							}}
							type="button">
							<span
								aria-hidden="true"
								style={{
									flex: "none",
									width: 18,
									height: 18,
									borderRadius: "50%",
									background: r.focal ? "var(--adsum-cyan)" : BRAND_CORAL,
									color: "#fff",
									fontSize: 10,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									marginTop: 1,
								}}>
								{r.kind === "sample" ? "▶" : "✎"}
							</span>
							<span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{r.title}</span>
							<Info
								label={`About ${r.title}`}
								text={`${r.blurb}. ${r.kind === "sample" ? "Click runs it straight away." : "Click writes it in the box; Enter sends it."}`}
							/>
						</button>
					))}
				</div>
			)}
		</div>
	)
}

export default EmptySession
