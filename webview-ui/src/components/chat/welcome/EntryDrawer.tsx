import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import type { Ranked, Suggestable } from "./suggest"

/**
 * The drawer — the ONE home for past sessions, and for every run that is not on the entry
 * surface right now.
 *
 * Before this, sessions were reachable from four places: a preview under the welcome, a separate
 * full-history page, a chevron on the resume button, and this list. Four homes for one feature is
 * how a person stops knowing where anything lives. Everything now lands here, and the entry
 * surface keeps exactly one named resume — an action, not a list.
 *
 * Depth, not a second screen: the recent few, then everything, in the same place. A filter that
 * only searched the visible three would be lying, so typing widens the search to all of them.
 */

/** How many sessions show before "see all". Enough to recognise the one you want, few enough that
 *  the runs below stay on screen. */
const RECENT = 3

export interface DrawerRun extends Suggestable {
	title: string
	/** The intent's own codicon, so a card is recognisable before it is read. */
	icon?: string
	blurb?: string
	meta?: string
	onRun: () => void
}

interface EntryDrawerProps {
	open: boolean
	onClose: () => void
	history: HistoryItem[]
	/** Ranked suggested runs — same list the entry cards come from, same order, one name. */
	runs: Ranked<DrawerRun>[]
	checks: DrawerRun[]
	samples: DrawerRun[]
	/** Marks a run the developer has never opened; clears when the drawer opens. */
	unseenRunIds?: string[]
}

const ageLabel = (ts: number, now: number): string => {
	const mins = Math.max(1, Math.round((now - ts) / 60000))
	if (mins < 60) return `${mins} min ago`
	const hours = Math.round(mins / 60)
	if (hours < 24) return `${hours} h ago`
	const days = Math.round(hours / 24)
	return days === 1 ? "yesterday" : `${days} d ago`
}

const folderOf = (item: HistoryItem): string =>
	item.cwdOnTaskInitialization ? (item.cwdOnTaskInitialization.split("/").pop() ?? "") : ""

const EntryDrawer: React.FC<EntryDrawerProps> = ({ open, onClose, history, runs, checks, samples, unseenRunIds = [] }) => {
	const [query, setQuery] = useState("")
	const [showAll, setShowAll] = useState(false)
	const searchRef = useRef<HTMLInputElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const now = Date.now()

	// Opening resets depth and the filter: a drawer that remembers a stale search looks broken.
	useEffect(() => {
		if (open) {
			setQuery("")
			setShowAll(false)
			searchRef.current?.focus()
		}
	}, [open])

	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation()
				onClose()
				return
			}
			// Trap the focus. This claims aria-modal, and a modal whose Tab walks out into the
			// page behind it is worse than one that never claimed to be modal: a keyboard user is
			// left typing into a composer they cannot see, with a dialog still covering it.
			if (e.key !== "Tab") return
			const panel = panelRef.current
			if (!panel) return
			const stops = [
				...panel.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'),
			].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null)
			if (stops.length === 0) return
			const first = stops[0]
			const last = stops[stops.length - 1]
			const active = document.activeElement as HTMLElement | null
			if (e.shiftKey && (active === first || !panel.contains(active))) {
				e.preventDefault()
				last.focus()
			} else if (!e.shiftKey && (active === last || !panel.contains(active))) {
				e.preventDefault()
				first.focus()
			}
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [open, onClose])

	const q = query.trim().toLowerCase()
	const match = (t: string) => !q || t.toLowerCase().includes(q)

	const sessions = useMemo(
		() =>
			history
				.filter((h) => h.ts && h.task)
				.filter((h) => match(h.task + " " + folderOf(h)))
				.sort((a, b) => b.ts - a.ts),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[history, q],
	)
	// A filter that searched only the visible three would answer "nothing matches" while the match
	// sat one row below the fold.
	const shownSessions = showAll || q ? sessions : sessions.slice(0, RECENT)

	const visibleRuns = runs.filter((r) => match(r.item.title + " " + (r.item.blurb ?? "")))
	const visibleChecks = checks.filter((c) => match(c.title + " " + (c.blurb ?? "")))
	const visibleSamples = samples.filter((s) => match(s.title + " " + (s.blurb ?? "")))
	const nothing = !shownSessions.length && !visibleRuns.length && !visibleChecks.length && !visibleSamples.length

	if (!open) return null

	const openSession = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((e) =>
			console.error("Error showing task:", e),
		)
		onClose()
	}
	const run = (r: DrawerRun) => {
		r.onRun()
		onClose()
	}

	return (
		<div
			aria-label="Browse sessions and runs"
			aria-modal="true"
			className="absolute inset-0 z-10 flex flex-col gap-2 p-3"
			data-testid="entry-drawer"
			ref={panelRef}
			role="dialog"
			style={{ background: "var(--vscode-sideBar-background)" }}>
			<div
				className="flex items-center gap-2 rounded-md px-2 py-1"
				style={{ border: "1px solid var(--vscode-panel-border)", background: "var(--vscode-input-background)" }}>
				<span aria-hidden="true" className="codicon codicon-search" style={{ fontSize: "12px", opacity: 0.7 }} />
				<input
					aria-label="Filter sessions and runs"
					className="flex-1 bg-transparent outline-none"
					data-testid="entry-drawer-filter"
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Filter sessions, runs, checks…"
					ref={searchRef}
					style={{ color: "var(--vscode-foreground)", fontSize: "12px" }}
					value={query}
				/>
			</div>

			<div className="flex-1 overflow-auto rounded-md" style={{ border: "1px solid var(--vscode-panel-border)" }}>
				{shownSessions.length > 0 && (
					<>
						<Group label={showAll || q ? `All sessions · ${sessions.length}` : "Recent sessions"} />
						{shownSessions.map((h) => (
							<Row
								key={h.id}
								meta={`${folderOf(h)} · ${ageLabel(h.ts, now)}`}
								onClick={() => openSession(h.id)}
								testId="entry-drawer-session"
								title={h.task}
							/>
						))}
						{!q && sessions.length > RECENT && (
							<button
								className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
								data-testid="entry-drawer-see-all"
								onClick={() => setShowAll(!showAll)}
								style={{ color: "var(--vscode-textLink-foreground)", fontSize: "12px" }}>
								{showAll ? `Show just the recent ${RECENT}` : `See all ${sessions.length} sessions`}
								{!showAll && <span style={{ marginLeft: "auto", opacity: 0.65 }}>older runs, searchable</span>}
							</button>
						)}
					</>
				)}

				{visibleRuns.length > 0 && (
					<>
						<Group label="Suggested runs" />
						{visibleRuns.map((r) => (
							<Row
								key={r.item.id}
								meta={r.item.meta}
								onClick={() => run(r.item)}
								testId="entry-drawer-run"
								title={r.item.title}
								unseen={unseenRunIds.includes(r.item.id)}
								why={r.why}
							/>
						))}
					</>
				)}

				{visibleChecks.length > 0 && (
					<>
						<Group label="Checks" />
						{visibleChecks.map((c) => (
							<Row key={c.id} meta={c.meta} onClick={() => run(c)} testId="entry-drawer-check" title={c.title} />
						))}
					</>
				)}

				{visibleSamples.length > 0 && (
					<>
						<Group label="Sample runs" />
						{visibleSamples.map((s) => (
							<Row
								key={s.id}
								meta={s.meta ?? "~1 min · no hardware"}
								onClick={() => run(s)}
								testId="entry-drawer-sample"
								title={s.title}
							/>
						))}
					</>
				)}

				{nothing && (
					<div className="px-3 py-4" style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px" }}>
						Nothing matches “{query}”.
					</div>
				)}
			</div>

			<div className="flex items-center gap-2" style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px" }}>
				<kbd>Esc</kbd> closes
				<button className="ml-auto underline" data-testid="entry-drawer-close" onClick={onClose}>
					Close
				</button>
			</div>
		</div>
	)
}

const Group: React.FC<{ label: string }> = ({ label }) => (
	<div
		className="px-3 pb-1 pt-2 uppercase"
		style={{ color: "var(--vscode-descriptionForeground)", fontSize: "10px", letterSpacing: "0.08em" }}>
		{label}
	</div>
)

const Row: React.FC<{
	title: string
	meta?: string
	why?: string
	unseen?: boolean
	onClick: () => void
	testId: string
}> = ({ title, meta, why, unseen, onClick, testId }) => (
	<button
		className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
		data-testid={testId}
		onClick={onClick}>
		<span className="flex w-full items-baseline gap-2">
			<span className="truncate" style={{ color: "var(--vscode-foreground)", fontSize: "12.5px" }}>
				{title}
			</span>
			{unseen && (
				<span
					style={{
						fontSize: "9px",
						border: "1px solid var(--vscode-charts-orange)",
						color: "var(--vscode-charts-orange)",
						borderRadius: "9px",
						padding: "0 5px",
					}}>
					new
				</span>
			)}
			{meta && (
				<span className="ml-auto shrink-0" style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px" }}>
					{meta}
				</span>
			)}
		</span>
		{why && <span style={{ color: "var(--vscode-charts-blue)", fontSize: "10.5px" }}>◆ {why}</span>}
	</button>
)

export default EntryDrawer
