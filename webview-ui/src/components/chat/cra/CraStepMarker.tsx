import { BRAND_CYAN_700 } from "../brandColors"

/** The five CRA phases, in order. Progress is shown by the harness checklist (the tracker) + the model's
 * per-step mermaid diagram (the visual); this marker is the scannable in-flow chapter title. */
export const CRA_STEPS = ["Inventory", "Scan CVEs", "Posture", "Triage", "Next"] as const

/**
 * In-flow CRA step marker (the "big title as the conversation evolves" piece). The cra-readiness workflow emits
 * a `### Step N/5 · Title` banner as it starts each phase; MarkdownBlock renders any heading matching that shape
 * as THIS styled chapter marker — a step chip + a big title + a `/5` counter — so the phase is easy to find when
 * scrolling a long run. Progress *indication* lives in the checklist + the per-step mermaid; the marker no longer
 * duplicates it with dots (one job each: title here, progress there). COLOUR = PROGRESS ONLY (cyan), never a verdict.
 */

const MUTED = "var(--vscode-descriptionForeground, #8a93a0)"

/** A real banner is short; cap the title so a model that dumps a wall of text can't render as a giant marker. */
const MAX_TITLE_LEN = 80

/** Parse a heading's text → {step,title} when it's a CRA step banner ("Step 3/5 · Read the posture"), else null. */
export function parseStepHeading(text: string): { step: number; title: string } | null {
	const trimmed = text.trim()
	// Defensive: only short, single-line headings are real banners (a dumped bit becomes one huge "heading").
	if (trimmed.length > MAX_TITLE_LEN + 12 || /[\r\n]/.test(trimmed)) {
		return null
	}
	const m = /^\s*Step\s+([1-5])\s*\/\s*5\s*[·:\-—]?\s*(.*)$/i.exec(trimmed)
	if (!m) {
		return null
	}
	const step = Number(m[1])
	const title = m[2].trim()
	if (title.length > MAX_TITLE_LEN) {
		return null
	}
	return { step, title: title || CRA_STEPS[step - 1] }
}

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
				background: BRAND_CYAN_700,
				color: "#ffffff",
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
		<span style={{ fontSize: 10.5, color: MUTED, flex: "none" }}>
			{step}/{CRA_STEPS.length}
		</span>
	</div>
)

export default CraStepMarker
