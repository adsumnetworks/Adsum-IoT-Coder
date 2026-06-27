import type { ClineMessage } from "@shared/ExtensionMessage"
import { useMemo } from "react"

/**
 * CRA progress rail (Tier 2). A thin, host-process-aware strip that shows which of the CRA workflow's five
 * steps is running, so a quiet pause (the live CVE lookup) reads as "working", not "stuck".
 *
 * Data source: the cra-readiness workflow's **step banners** (`### Step N/5 · …`, Tier 1) already in the chat
 * stream — a stable, intentional signal. We derive progress from them rather than adding a host push channel,
 * so the rail is self-contained, self-gating (no banners → renders nothing → no rail outside a CRA run), and
 * tied to real events. COLOUR = PROCESS STATE ONLY (pending / active / done) — never a findings verdict; "done"
 * uses the progress accent, deliberately NOT green, so it can never read as "you passed".
 */

export const CRA_STEPS = ["Inventory", "Scan CVEs", "Posture", "Triage", "Next"] as const

/** Active-step caption (the plain-English "what's happening + not stuck" line), keyed by step number. */
const STEP_CAPTION: Record<number, string> = {
	1: "Listing every component your firmware is built from.",
	2: "Matching components against the OSV + NVD databases. Live lookup — can take ~10–30s.",
	3: "Checking your build's security settings against the CRA's essential requirements.",
	4: "Using your build's own evidence to see which findings are reachable.",
	5: "The single highest-value thing to do next — your call.",
}

const STEP_BANNER_RE = /(?:^|\n)\s*#{0,4}\s*Step\s+([1-5])\s*\/\s*5\b/g

export interface CraProgress {
	/** 1..5 — the highest step announced so far. */
	current: number
	/** All five steps finished (the run reached its wrap-up). */
	done: boolean
}

/**
 * Derive CRA progress from the message stream. Returns null when this isn't a CRA run (no step banner seen) —
 * the rail then renders nothing. Pure + testable.
 */
export function parseCraProgress(messages: ClineMessage[]): CraProgress | null {
	let current = 0
	let sawCompletion = false
	for (const m of messages) {
		if (m.say === "completion_result") {
			sawCompletion = true
		}
		const text = m.text
		if (!text) {
			continue
		}
		STEP_BANNER_RE.lastIndex = 0
		let match: RegExpExecArray | null = STEP_BANNER_RE.exec(text)
		while (match !== null) {
			const n = Number(match[1])
			if (n > current) {
				current = n
			}
			match = STEP_BANNER_RE.exec(text)
		}
	}
	if (current === 0) {
		return null
	}
	return { current, done: sawCompletion && current >= CRA_STEPS.length }
}

interface SegState {
	label: string
	status: "done" | "active" | "pending"
}

function segStates(p: CraProgress): SegState[] {
	return CRA_STEPS.map((label, i) => {
		const step = i + 1
		let status: SegState["status"]
		if (p.done || step < p.current) {
			status = "done"
		} else if (step === p.current) {
			status = "active"
		} else {
			status = "pending"
		}
		return { label, status }
	})
}

const ACCENT = "var(--vscode-progressBar-background, #2fd4d4)"
const MUTED = "var(--vscode-descriptionForeground, #8a93a0)"
const DONE_INK = "var(--vscode-foreground, #e6edf3)"

/** The rail. Renders nothing when `messages` show no CRA run (self-gating). */
export const CraProgressRail = ({ messages }: { messages: ClineMessage[] }) => {
	const progress = useMemo(() => parseCraProgress(messages), [messages])
	if (!progress) {
		return null
	}
	const segs = segStates(progress)
	const activeStep = progress.done ? 0 : progress.current
	return (
		<div
			aria-label={`CRA progress: step ${progress.current} of ${CRA_STEPS.length}${progress.done ? " (done)" : ""}`}
			data-testid="cra-progress-rail"
			style={{
				padding: "9px 13px 10px",
				borderBottom: "1px solid var(--vscode-editorGroup-border, #3c3c3c)",
				background: "var(--vscode-sideBar-background, transparent)",
			}}>
			<div style={{ display: "flex", alignItems: "center" }}>
				{segs.map((s, i) => (
					<div
						key={s.label}
						style={{ display: "flex", alignItems: "center", flex: i < segs.length - 1 ? 1 : "0 0 auto" }}>
						<span
							aria-hidden
							style={{
								width: 13,
								height: 13,
								borderRadius: "50%",
								flex: "none",
								border: `2px solid ${s.status === "pending" ? MUTED : ACCENT}`,
								background: s.status === "done" ? ACCENT : "transparent",
								boxShadow:
									s.status === "active" ? `0 0 0 3px color-mix(in srgb, ${ACCENT} 22%, transparent)` : "none",
							}}
						/>
						{i < segs.length - 1 && (
							<span
								aria-hidden
								style={{
									height: 2,
									flex: 1,
									margin: "0 2px",
									background: s.status === "done" || s.status === "active" ? ACCENT : MUTED,
									opacity: s.status === "done" || s.status === "active" ? 1 : 0.4,
								}}
							/>
						)}
					</div>
				))}
			</div>
			<div style={{ display: "flex", marginTop: 6 }}>
				{segs.map((s, i) => (
					<span
						key={s.label}
						style={{
							flex: i < segs.length - 1 ? 1 : "0 0 auto",
							fontSize: 9.5,
							letterSpacing: ".01em",
							color: s.status === "active" ? ACCENT : s.status === "done" ? DONE_INK : MUTED,
							fontWeight: s.status === "active" ? 600 : 400,
							whiteSpace: "nowrap",
						}}>
						{s.label}
					</span>
				))}
			</div>
			<div style={{ marginTop: 8, fontSize: 11.5, color: DONE_INK }}>
				{progress.done ? (
					<span style={{ color: MUTED }}>
						CRA preview complete — full report written; see the chat for your next step.
					</span>
				) : (
					<>
						<span style={{ color: ACCENT, fontWeight: 600 }}>
							Step {activeStep}/{CRA_STEPS.length} · {CRA_STEPS[activeStep - 1]}
						</span>{" "}
						<span style={{ color: MUTED }}>— {STEP_CAPTION[activeStep]}</span>
					</>
				)}
			</div>
		</div>
	)
}

export default CraProgressRail
