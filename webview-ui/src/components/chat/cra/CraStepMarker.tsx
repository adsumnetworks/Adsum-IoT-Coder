import { CRA_STEPS } from "./CraProgressRail"

/**
 * In-flow CRA step marker (the "big title as the conversation evolves" piece). The cra-readiness workflow emits
 * a `### Step N/5 · Title` banner as it starts each phase; MarkdownBlock renders any heading matching that shape
 * as THIS styled chapter marker — a step chip + a big title + a mini progress strip — so the progressing line
 * appears in the conversation at every relevant step, aligned with the floating rail + the to-do checklist (one
 * 5-step model, three surfaces). COLOUR = PROGRESS ONLY (cyan), never a findings verdict.
 */

const ACCENT = "var(--vscode-progressBar-background, #2fd4d4)"
const MUTED = "var(--vscode-descriptionForeground, #8a93a0)"

/** Parse a heading's text → {step,title} when it's a CRA step banner ("Step 3/5 · Read the posture"), else null. */
export function parseStepHeading(text: string): { step: number; title: string } | null {
	const m = /^\s*Step\s+([1-5])\s*\/\s*5\s*[·:\-—]?\s*(.*)$/i.exec(text.trim())
	if (!m) {
		return null
	}
	const step = Number(m[1])
	return { step, title: m[2].trim() || CRA_STEPS[step - 1] }
}

const MiniDots = ({ current }: { current: number }) => (
	<span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
		{CRA_STEPS.map((label, i) => {
			const step = i + 1
			const lit = step <= current
			return (
				<span
					aria-hidden
					key={label}
					style={{
						width: 7,
						height: 7,
						borderRadius: "50%",
						background: lit ? ACCENT : "transparent",
						border: `1.5px solid ${lit ? ACCENT : MUTED}`,
						boxShadow: step === current ? `0 0 0 2px color-mix(in srgb, ${ACCENT} 22%, transparent)` : "none",
					}}
				/>
			)
		})}
	</span>
)

/** The styled chapter marker rendered in place of a `### Step N/5 ·` heading. */
export const CraStepMarker = ({ step, title }: { step: number; title: string }) => (
	<div
		aria-label={`Step ${step} of ${CRA_STEPS.length}: ${title}`}
		data-testid="cra-step-marker"
		style={{
			display: "flex",
			alignItems: "center",
			gap: 10,
			margin: "16px 0 8px",
			paddingTop: 12,
			borderTop: "1px solid var(--vscode-editorGroup-border, #3c3c3c)",
		}}>
		<span
			aria-hidden
			style={{
				flex: "none",
				width: 22,
				height: 22,
				borderRadius: "50%",
				background: ACCENT,
				color: "var(--vscode-editor-background, #1e1e1e)",
				fontWeight: 800,
				fontSize: 12,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}>
			{step}
		</span>
		<span style={{ fontSize: 15, fontWeight: 700, color: "var(--vscode-foreground, #e6edf3)", flex: 1, minWidth: 0 }}>
			{title}
		</span>
		<MiniDots current={step} />
		<span style={{ fontSize: 10.5, color: MUTED, flex: "none" }}>
			{step}/{CRA_STEPS.length}
		</span>
	</div>
)

export default CraStepMarker
