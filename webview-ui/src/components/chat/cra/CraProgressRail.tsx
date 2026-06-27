import type { ClineMessage } from "@shared/ExtensionMessage"
import { useMemo } from "react"
import { BRAND_CYAN_600, brandAlpha } from "../brandColors"

/**
 * CRA progress rail (Tier 2). A thin, host-process-aware strip showing which of the CRA workflow's five steps is
 * running, so a quiet pause (the live CVE lookup) reads as "working", not "stuck".
 *
 * Data source: the cra-readiness workflow's **step banners** (`### Step N/5 · …`, Tier 1) already in the chat
 * stream — a stable, intentional signal. We derive progress from them (no host push channel), so the rail is
 * self-gating (no banners → renders nothing). Steps 1–4 are the one-time assessment (linear). Step 5 on a REAL
 * project is the remediation **loop** — the bit emits `Step 5/5 · Remediate — gap N of M · <gap>` per iteration;
 * the rail renders it as a spinning loop node + the current gap, and only marks "done" at a real loop exit
 * (completion_result). The sample preview keeps the simple `Step 5/5 · One concrete next step → done`.
 * COLOUR = PROCESS STATE ONLY (cyan); never a findings verdict — "done" is cyan, never green.
 */

export const CRA_STEPS = ["Inventory", "Scan CVEs", "Posture", "Triage", "Next"] as const

const STEP_CAPTION: Record<number, string> = {
	1: "Listing every component your firmware is built from.",
	2: "Matching components against the OSV + NVD databases. Live lookup — can take ~10–30s.",
	3: "Checking your build's security settings against the CRA's essential requirements.",
	4: "Using your build's own evidence to see which findings are reachable.",
	5: "The single highest-value thing to do next — your call.",
}

const STEP_BANNER_RE = /(?:^|\n)\s*#{0,4}\s*Step\s+([1-5])\s*\/\s*5\b/g
/** Real-project step 5 loop banner: `Step 5/5 · Remediate — gap N of M · <gap name>` (name optional). */
const REMEDIATE_RE = /Step\s+5\s*\/\s*5\s*[·:]?\s*Remediate\b[^\n]*?gap\s+(\d+)\s+of\s+(\d+)\s*(?:[·:—-]\s*([^\n]+))?/gi

export interface RemediationState {
	/** Current gap number being worked. */
	gap: number
	/** Total gaps in the offer pool (M). */
	total: number
	/** Current gap's name (may be empty if the banner omitted it). */
	currentName: string
	/** One entry per gap iteration announced so far (deduped by gap number, in order). */
	history: { gap: number; name: string }[]
}

export interface CraProgress {
	/** 1..5 — the highest step announced so far. */
	current: number
	/** The run reached a real exit (completion_result). */
	done: boolean
	/** Present only on the real-project remediation loop (step 5). */
	remediation?: RemediationState
}

/**
 * Derive CRA progress from the message stream. Returns null when this isn't a CRA run (no step banner). Pure.
 * Non-remediation returns are exactly `{current, done}` (no `remediation` key) so existing assertions hold.
 */
export function parseCraProgress(messages: ClineMessage[]): CraProgress | null {
	let current = 0
	let sawCompletion = false
	const remIters: { gap: number; name: string }[] = []
	let remTotal = 0
	for (const m of messages) {
		if (m.say === "completion_result") {
			sawCompletion = true
		}
		// ONLY count banners the MODEL narrated (say:"text"). Tool results / user messages — especially the
		// read_file RESULT of the workflow bit itself, which contains the EXAMPLE banners "Step 1/5 … Step 5/5 ·
		// Remediate" — must NOT drive the rail, or it jumps to the end the instant the workflow is loaded.
		if (m.say !== "text") {
			continue
		}
		const text = m.text
		if (!text) {
			continue
		}
		STEP_BANNER_RE.lastIndex = 0
		let s: RegExpExecArray | null = STEP_BANNER_RE.exec(text)
		while (s !== null) {
			const n = Number(s[1])
			if (n > current) {
				current = n
			}
			s = STEP_BANNER_RE.exec(text)
		}
		REMEDIATE_RE.lastIndex = 0
		let r: RegExpExecArray | null = REMEDIATE_RE.exec(text)
		while (r !== null) {
			remIters.push({ gap: Number(r[1]), name: (r[3] || "").trim() })
			remTotal = Number(r[2])
			current = 5
			r = REMEDIATE_RE.exec(text)
		}
	}
	if (current === 0) {
		return null
	}
	if (remIters.length > 0) {
		// Dedupe by gap number (latest name wins), keep ascending order.
		const byGap = new Map<number, string>()
		for (const it of remIters) {
			byGap.set(it.gap, it.name)
		}
		const history = [...byGap.entries()].sort((a, b) => a[0] - b[0]).map(([gap, name]) => ({ gap, name }))
		const last = remIters[remIters.length - 1]
		return {
			current: 5,
			done: sawCompletion,
			remediation: { gap: last.gap, total: remTotal, currentName: last.name, history },
		}
	}
	return { current, done: sawCompletion && current >= CRA_STEPS.length }
}

// Brand cyan = PROGRESS accent (matches DemoPicker/IntentCard); neutral tokens for pending/text.
const ACCENT = BRAND_CYAN_600
const ACCENT_GLOW = brandAlpha(BRAND_CYAN_600, 0.22)
const MUTED = "var(--vscode-descriptionForeground, #8a93a0)"
const DONE_INK = "var(--vscode-foreground, #e6edf3)"

/** The rail. Renders nothing when `messages` show no CRA run (self-gating). */
export const CraProgressRail = ({ messages }: { messages: ClineMessage[] }) => {
	const progress = useMemo(() => parseCraProgress(messages), [messages])
	if (!progress) {
		return null
	}
	const rem = progress.remediation
	const looping = !!rem && !progress.done
	const lastIdx = CRA_STEPS.length - 1
	const status = (step: number): "done" | "active" | "pending" => {
		if (progress.done || step < progress.current) {
			return "done"
		}
		return step === progress.current ? "active" : "pending"
	}
	return (
		<div
			aria-label={`CRA progress: step ${progress.current} of ${CRA_STEPS.length}${looping ? ` (remediating, gap ${rem.gap} of ${rem.total})` : progress.done ? " (done)" : ""}`}
			data-testid="cra-progress-rail"
			style={{
				padding: "9px 13px 10px",
				borderBottom: "1px solid var(--vscode-editorGroup-border, #3c3c3c)",
				background: "var(--vscode-sideBar-background, transparent)",
			}}>
			<div style={{ display: "flex", alignItems: "center" }}>
				{CRA_STEPS.map((label, i) => {
					const st = status(i + 1)
					const isLoopNode = i === lastIdx && looping
					return (
						<div key={label} style={{ display: "flex", alignItems: "center", flex: i < lastIdx ? 1 : "0 0 auto" }}>
							{isLoopNode ? (
								<span
									aria-hidden
									data-testid="cra-loop-node"
									style={{
										width: 19,
										height: 19,
										borderRadius: "50%",
										flex: "none",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										border: `2px solid ${ACCENT}`,
										color: ACCENT,
										fontSize: 12,
										boxShadow: `0 0 0 3px ${ACCENT_GLOW}`,
									}}>
									↻
								</span>
							) : (
								<span
									aria-hidden
									style={{
										width: 13,
										height: 13,
										borderRadius: "50%",
										flex: "none",
										border: `2px solid ${st === "pending" ? MUTED : ACCENT}`,
										background: st === "done" ? ACCENT : "transparent",
										boxShadow: st === "active" ? `0 0 0 3px ${ACCENT_GLOW}` : "none",
									}}
								/>
							)}
							{i < lastIdx && (
								<span
									aria-hidden
									style={{
										height: 2,
										flex: 1,
										margin: "0 2px",
										background: st === "done" || st === "active" ? ACCENT : MUTED,
										opacity: st === "done" || st === "active" ? 1 : 0.4,
									}}
								/>
							)}
						</div>
					)
				})}
			</div>
			<div style={{ display: "flex", marginTop: 6 }}>
				{CRA_STEPS.map((label, i) => {
					const st = status(i + 1)
					const text = i === lastIdx && looping ? "Remediate" : label
					return (
						<span
							key={label}
							style={{
								flex: i < lastIdx ? 1 : "0 0 auto",
								fontSize: 9.5,
								letterSpacing: ".01em",
								color: st === "active" ? ACCENT : st === "done" ? DONE_INK : MUTED,
								fontWeight: st === "active" ? 600 : 400,
								whiteSpace: "nowrap",
							}}>
							{text}
						</span>
					)
				})}
			</div>
			{/* Caption */}
			<div style={{ marginTop: 8, fontSize: 11.5, color: DONE_INK }}>
				{progress.done ? (
					<span style={{ color: MUTED }}>
						{rem
							? `Remediation paused — report + log updated. Re-run any time to pick up the rest.`
							: "CRA preview complete — full report written; see the chat for your next step."}
					</span>
				) : looping ? (
					<>
						<span style={{ color: ACCENT, fontWeight: 600 }}>
							Step 5/5 · Remediate — gap {rem.gap} of {rem.total}
							{rem.currentName ? ` · ${rem.currentName}` : ""}
						</span>{" "}
						<span style={{ color: MUTED }}>— apply → rebuild → re-scan (repeats per gap you choose).</span>
					</>
				) : (
					<>
						<span style={{ color: ACCENT, fontWeight: 600 }}>
							Step {progress.current}/{CRA_STEPS.length} · {CRA_STEPS[progress.current - 1]}
						</span>{" "}
						<span style={{ color: MUTED }}>— {STEP_CAPTION[progress.current]}</span>
					</>
				)}
			</div>
			{/* Iteration list — only while the loop runs; compact, progress-only (never a 'fixed' verdict). */}
			{looping && rem.history.length > 0 && (
				<div style={{ marginTop: 8, borderTop: "1px solid var(--vscode-editorGroup-border, #3c3c3c)", paddingTop: 7 }}>
					{rem.history.map((h) => {
						const isCurrent = h.gap === rem.gap
						return (
							<div
								key={h.gap}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 7,
									fontSize: 11,
									color: MUTED,
									margin: "3px 0",
								}}>
								<span
									aria-hidden
									style={{
										width: 7,
										height: 7,
										borderRadius: "50%",
										flex: "none",
										background: isCurrent ? "transparent" : ACCENT,
										border: `${isCurrent ? 2 : 1}px solid ${ACCENT}`,
									}}
								/>
								gap {h.gap}
								{h.name ? ` · ${h.name}` : ""} {isCurrent ? "— in progress" : "— applied, re-scanned"}
							</div>
						)
					})}
					{rem.total > rem.history.length && (
						<div style={{ fontSize: 11, color: MUTED, margin: "3px 0", opacity: 0.8 }}>
							+ {rem.total - rem.history.length} more gap{rem.total - rem.history.length > 1 ? "s" : ""} pending
							your call
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default CraProgressRail
