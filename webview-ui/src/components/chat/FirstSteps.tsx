import type React from "react"
import { useEffect, useState } from "react"
import { AdsumMark } from "@/components/common/AdsumLogo"
import Info from "@/components/common/Info"
import { firstStepsState, type FirstStepId, type FirstStepsInput } from "@/utils/firstStepsState"
import { BRAND_CYAN_UI } from "./brandColors"

const DISMISSED_KEY = "adsum.firstSteps.dismissed"

/**
 * Whether the card would show, asked from outside — same shape as DockCoachMark's eligibility export.
 * localStorage can throw in a locked-down webview; a failure to read means "do not show", never a crash.
 */
export function firstStepsEligible(): boolean {
	try {
		return localStorage.getItem(DISMISSED_KEY) !== "1"
	} catch {
		return false
	}
}

const ROW_COPY: Record<FirstStepId, { title: string; blurb: string }> = {
	sample: {
		title: "Run the sample debug session",
		blurb: "A real BLE bug on real nRF source · about a minute · nothing to install.",
	},
	openProject: {
		title: "Open your project",
		blurb: "Pick the folder you want Adsum working in.",
	},
	build: {
		title: "Build, flash and debug a board",
		blurb: "Build it, flash the connected board, then stream the live logs and watch for faults.",
	},
	register: {
		title: "Register for free",
		blurb: "An account, not a card — it unlocks the cellular and gateway bits.",
	},
	gateway: {
		title: "Set up a gateway",
		blurb: "Plan, parts, identify, flash the pair, commission, first reading · 7 steps.",
	},
}

export interface FirstStepsProps {
	state: FirstStepsInput
	onRunSample: () => void
	onOpenProject: () => void
	onPrefillBuild: () => void
	onRegister: () => void
	onPrefillGateway: () => void
}

/**
 * [0.5 sessions first] Replaces the three standing rows that used to sit under "Say what you want done" —
 * five rows this time, each one a step most developers take in roughly this order, with a checkbox read
 * from the host's own facts (never from a click on the card) and a "Show me" pill on the one row that is
 * next. Dismiss is for good: the localStorage key never comes back once the × is clicked, same contract
 * as the other one-time cards on this surface (DockCoachMark, the registered banner).
 */
const FirstSteps: React.FC<FirstStepsProps> = ({ state, onRunSample, onOpenProject, onPrefillBuild, onRegister, onPrefillGateway }) => {
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		setVisible(firstStepsEligible())
	}, [])

	if (!visible) {
		return null
	}

	const dismiss = () => {
		try {
			localStorage.setItem(DISMISSED_KEY, "1")
		} catch {
			/* a webview with storage blocked still gets to dismiss it for this session */
		}
		setVisible(false)
	}

	const { rows, nextId } = firstStepsState(state)
	const actions: Record<FirstStepId, () => void> = {
		sample: onRunSample,
		openProject: onOpenProject,
		build: onPrefillBuild,
		register: onRegister,
		gateway: onPrefillGateway,
	}

	return (
		<div data-testid="first-steps" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 2px" }}>
			<div className="flex items-center justify-between gap-2">
				<span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600 }}>
					<AdsumMark size={14} />
					First steps
				</span>
				<button
					aria-label="Dismiss First steps"
					onClick={dismiss}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						fontSize: 12,
						lineHeight: 1,
						color: "var(--vscode-descriptionForeground)",
						opacity: 0.6,
						padding: "2px 4px",
					}}
					type="button">
					×
				</button>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
				{rows.map((row) => {
					const isNext = row.id === nextId
					const copy = ROW_COPY[row.id]
					return (
						<div
							data-testid={`first-steps-row-${row.id}`}
							key={row.id}
							style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", opacity: row.done ? 0.55 : 1 }}>
							<span aria-hidden="true" style={{ flex: "none", width: 14, textAlign: "center", fontSize: 11 }}>
								{row.done ? "☑" : "☐"}
							</span>
							<span
								style={{
									flex: 1,
									minWidth: 0,
									fontSize: 12.5,
									fontWeight: isNext ? 600 : 400,
									textDecoration: row.done ? "line-through" : "none",
								}}>
								{copy.title}
							</span>
							{isNext && (
								<button
									onClick={actions[row.id]}
									style={{
										flex: "none",
										font: "inherit",
										fontSize: 11,
										fontWeight: 600,
										padding: "2px 8px",
										borderRadius: 10,
										border: "none",
										background: BRAND_CYAN_UI,
										color: "#fff",
										cursor: "pointer",
									}}
									type="button">
									Show me
								</button>
							)}
							<Info label={`About ${copy.title}`} text={copy.blurb} />
						</div>
					)
				})}
			</div>
		</div>
	)
}

export default FirstSteps
