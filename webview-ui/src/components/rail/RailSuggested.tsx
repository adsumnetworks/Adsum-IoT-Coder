import type React from "react"
import type { Ranked } from "../chat/welcome/suggest"
import { KIND_WORD, R } from "./railStyles"
import type { Run } from "./useRankedRuns"

interface Props {
	rows: Ranked<Run>[]
	onRun: (run: Run) => void
	onLocked: (run: Run) => void
}

/** One run row, shared by Suggested and the palette: the icon, the title with its kind, the blurb, the reason. */
export const RunRow: React.FC<{
	r: Ranked<Run>
	focal?: boolean
	active?: boolean
	onRun: (run: Run) => void
	onLocked: (run: Run) => void
	id?: string
	role?: string
	selected?: boolean
}> = ({ r, focal, active, onRun, onLocked, id, role, selected }) => {
	const run = r.item
	const locked = run.kind === "locked"
	return (
		<div>
			<button
				aria-selected={selected}
				data-testid={`run-${run.id}`}
				id={id}
				onClick={() => (locked ? onLocked(run) : onRun(run))}
				role={role}
				style={{
					...R.row(focal, locked),
					background: active
						? "color-mix(in srgb, var(--vscode-foreground) 10%, transparent)"
						: R.row(focal, locked).background,
				}}
				type="button">
				<span aria-hidden="true" style={R.icon(focal, locked)}>
					{locked ? "🔒" : run.kind === "fire" || run.kind === "sample" ? "▶" : run.kind === "open-folder" ? "⌂" : "✎"}
				</span>
				<span style={{ minWidth: 0 }}>
					<span
						style={{
							...R.title,
							color: locked ? "color-mix(in srgb, var(--vscode-foreground) 78%, transparent)" : R.title.color,
						}}>
						{run.title}
						<span style={R.kind}>{KIND_WORD[run.kind]}</span>
					</span>
					<br />
					<span style={R.meta}>
						{run.blurb}
						{run.meta ? ` · ${run.meta}` : ""}
					</span>
					{r.grounded && r.why ? (
						<>
							<br />
							<span style={{ ...R.meta, color: "var(--adsum-cyan-text)" }}>◆ {r.why}</span>
						</>
					) : null}
				</span>
			</button>
			{locked && (
				<div style={{ display: "flex", gap: 6, margin: "2px 0 0 34px", alignItems: "center", flexWrap: "wrap" }}>
					<span style={R.meta}>
						{run.lockPill === "Register" ? "needs a registered account ·" : "opened on request ·"}
					</span>
					<button onClick={() => onLocked(run)} style={R.pill("pri")} type="button">
						{run.lockPill ?? "Register"}
					</button>
				</div>
			)}
		</div>
	)
}

/**
 * [0.5 sessions first] At most three rows, only grounded ones (a detection or the open project names the
 * reason), the first one focal. Nothing grounded, nothing shown: the whole catalogue is one keystroke away.
 */
const RailSuggested: React.FC<Props> = ({ rows, onRun, onLocked }) => {
	if (!rows.length) {
		return null
	}
	return (
		<div data-testid="rail-suggested" style={R.block}>
			<div style={R.blockHead}>
				<span style={R.label}>Suggested</span>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				{rows.map((r, i) => (
					<RunRow focal={i === 0 && r.item.kind !== "locked"} key={r.item.id} onLocked={onLocked} onRun={onRun} r={r} />
				))}
			</div>
		</div>
	)
}

export default RailSuggested
