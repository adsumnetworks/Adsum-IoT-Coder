import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Ranked } from "../chat/welcome/suggest"
import Info from "../common/Info"
import { RunRow } from "./RailSuggested"
import { R } from "./railStyles"
import type { Run, RunGroup } from "./useRankedRuns"

const GROUPS: RunGroup[] = ["Runs", "Journeys", "Checks", "Samples"]

interface Props {
	open: boolean
	runs: Ranked<Run>[]
	suggested: Ranked<Run>[]
	onClose: () => void
	onRun: (run: Run) => void
	onLocked: (run: Run) => void
}

/**
 * [0.5 sessions first] Every former card, in one dialog: For this desk (the grounded rows, lifted), then
 * Runs, Journeys, Checks, Samples. The filter has focus on open; ↑↓ move, Enter runs or fills the box, Esc
 * closes; a locked row opens the gate. A one-time hint explains the two row kinds.
 */
const Palette: React.FC<Props> = ({ open, runs, suggested, onClose, onRun, onLocked }) => {
	const [filter, setFilter] = useState("")
	const [index, setIndex] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)

	const flat = useMemo(() => {
		const f = filter.trim().toLowerCase()
		const hit = (r: Ranked<Run>) => !f || `${r.item.title} ${r.item.blurb}`.toLowerCase().includes(f)
		const lifted = new Set(suggested.map((s) => s.item.id))
		const out: Array<{ group: string; r: Ranked<Run> }> = []
		suggested.filter(hit).forEach((r) => out.push({ group: "For this desk", r }))
		for (const g of GROUPS) {
			runs.filter((r) => r.item.group === g && !lifted.has(r.item.id) && hit(r)).forEach((r) => out.push({ group: g, r }))
		}
		return out
	}, [runs, suggested, filter])

	useEffect(() => {
		if (open) {
			setFilter("")
			setIndex(0)
			setTimeout(() => inputRef.current?.focus(), 0)
		}
	}, [open])
	useEffect(() => {
		if (index >= flat.length) {
			setIndex(Math.max(0, flat.length - 1))
		}
	}, [flat.length, index])

	if (!open) {
		return null
	}
	const pick = (r: Ranked<Run>) => (r.item.kind === "locked" ? onLocked(r.item) : onRun(r.item))
	const onKey = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault()
			onClose()
		} else if (e.key === "ArrowDown") {
			e.preventDefault()
			setIndex((i) => Math.min(flat.length - 1, i + 1))
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setIndex((i) => Math.max(0, i - 1))
		} else if (e.key === "Enter") {
			e.preventDefault()
			const hit = flat[index]
			if (hit) {
				pick(hit.r)
			}
		}
	}

	let lastGroup = ""
	return (
		<div
			onKeyDown={onKey}
			role="presentation"
			style={{
				position: "fixed",
				inset: 0,
				background: "rgba(0,0,0,.45)",
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				padding: "18px 12px",
				zIndex: 30,
			}}>
			<div
				aria-label="What can you ask"
				aria-modal="true"
				role="dialog"
				style={{
					background: "var(--vscode-editorWidget-background, var(--vscode-sideBar-background))",
					border: "1px solid var(--vscode-panel-border, color-mix(in srgb, var(--vscode-foreground) 20%, transparent))",
					borderRadius: 10,
					padding: "12px 14px",
					width: "100%",
					maxWidth: 440,
					maxHeight: "92%",
					overflow: "auto",
					position: "relative",
				}}>
				<button
					aria-label="Close"
					onClick={onClose}
					style={{
						position: "absolute",
						top: 8,
						right: 10,
						background: "none",
						border: 0,
						color: "var(--vscode-descriptionForeground)",
						fontSize: 16,
						cursor: "pointer",
						lineHeight: 1,
					}}
					type="button">
					×
				</button>
				<h3 style={{ ...R.headline, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 6 }}>
					What can you ask
					<Info text="Every run, journey, check and sample. ▶ runs now in a new tab; ✎ opens a tab with the prompt written, Enter sends it. ↑↓ move, Enter picks, Esc closes." />
				</h3>
				<input
					aria-activedescendant={flat[index] ? `pal-${index}` : undefined}
					aria-controls="pal-list"
					aria-expanded="true"
					aria-label="Filter"
					onChange={(e) => {
						setFilter(e.target.value)
						setIndex(0)
					}}
					placeholder="Filter runs, journeys, checks, samples…"
					ref={inputRef}
					role="combobox"
					style={{
						font: "inherit",
						fontSize: 12.5,
						width: "100%",
						background: "var(--vscode-input-background)",
						border: "1px solid var(--vscode-input-border, transparent)",
						borderRadius: 6,
						padding: "6px 9px",
						color: "var(--vscode-input-foreground)",
						marginBottom: 8,
					}}
					value={filter}
				/>
				<div id="pal-list" role="listbox" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
					{flat.map(({ group, r }, k) => {
						const head =
							group !== lastGroup ? (
								<div key={`g-${group}`} style={{ ...R.label, margin: "6px 0 2px" }}>
									{group}
								</div>
							) : null
						lastGroup = group
						return (
							<div key={`${group}-${r.item.id}`}>
								{head}
								<RunRow
									active={k === index}
									id={`pal-${k}`}
									onLocked={onLocked}
									onRun={onRun}
									r={r}
									role="option"
									selected={k === index}
									showWhy={k === 0 || flat[k - 1].group !== group || flat[k - 1].r.why !== r.why}
								/>
							</div>
						)
					})}
					{flat.length === 0 && <div style={R.label}>nothing matches</div>}
				</div>
			</div>
		</div>
	)
}

export default Palette
