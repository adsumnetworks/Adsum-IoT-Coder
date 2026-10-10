import type React from "react"
import type { Ranked } from "../chat/welcome/suggest"
import Info from "../common/Info"
import { KIND_SENTENCE, R } from "./railStyles"
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
	const detail = [run.blurb, run.meta, KIND_SENTENCE[run.kind]].filter(Boolean).join(" · ")
	return (
		<div
			style={{
				...R.row(focal, locked),
				padding: "4px 6px 4px 8px",
				alignItems: "center",
				background: active
					? "color-mix(in srgb, var(--vscode-foreground) 10%, transparent)"
					: R.row(focal, locked).background,
			}}>
			<button
				aria-selected={selected}
				data-testid={`run-${run.id}`}
				id={id}
				onClick={() => (locked ? onLocked(run) : onRun(run))}
				role={role}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					flex: 1,
					minWidth: 0,
					background: "none",
					border: 0,
					padding: 0,
					color: "inherit",
					font: "inherit",
					textAlign: "left",
					cursor: "pointer",
				}}
				type="button">
				<span aria-hidden="true" style={R.icon(focal, locked)}>
					{locked ? "🔒" : run.kind === "fire" || run.kind === "sample" ? "▶" : run.kind === "open-folder" ? "⌂" : "✎"}
				</span>
				<span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
					<span
						style={{
							...R.title,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							color: locked ? "color-mix(in srgb, var(--vscode-foreground) 78%, transparent)" : R.title.color,
						}}>
						{run.title}
					</span>
					{r.grounded && r.why ? (
						<span
							style={{
								...R.meta,
								color: "var(--adsum-cyan-text)",
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}>
							◆ {r.why}
						</span>
					) : null}
				</span>
			</button>
			{locked ? (
				<button
					onClick={() => onLocked(run)}
					style={{ ...R.pill("pri"), fontSize: 10.5, padding: "1px 7px" }}
					type="button">
					{run.lockPill ?? "Register"}
				</button>
			) : null}
			<Info label={`About ${run.title}`} text={detail} />
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
