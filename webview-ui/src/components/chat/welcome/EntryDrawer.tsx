import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { BRAND_CORAL, BRAND_CYAN_600 } from "../brandColors"
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
	/** What had focus before the drawer opened, so closing can hand it back. */
	const returnFocusRef = useRef<HTMLElement | null>(null)
	const now = Date.now()

	// Opening resets depth and the filter: a drawer that remembers a stale search looks broken.
	useEffect(() => {
		if (open) {
			// Remember where focus came from. Closing a dialog without handing it back drops the
			// caret at the top of the document, which is disorienting exactly for the people who
			// rely on the keyboard — the same people the trap above is for.
			returnFocusRef.current = document.activeElement as HTMLElement | null
			setQuery("")
			setShowAll(false)
			searchRef.current?.focus()
		} else if (returnFocusRef.current) {
			returnFocusRef.current.focus?.()
			returnFocusRef.current = null
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
				// `offsetParent !== null` looks like the obvious visibility test and is a trap of its own:
				// jsdom always returns null, so the guard silently empties this list and the whole focus
				// trap becomes a no-op under test — passing while protecting nothing. This drawer never
				// renders a hidden control anyway (rows are conditional, not hidden), so `hidden` and
				// `disabled` are the only exclusions that can actually occur here.
			].filter((el) => !el.hasAttribute("disabled") && !el.hasAttribute("hidden"))
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
	// Repeating one folder name down the list costs the width the task title needs and tells the
	// reader nothing. It earns its place only when the rows actually come from different folders.
	const foldersDiffer = new Set(shownSessions.map(folderOf)).size > 1
	// [OPERATOR 2026-09-04] Three rows read "Debug a real BLE NUS bug — Central→Peripheral works,
	// b… · Desktop · yesterday", identically, and nothing on screen could tell them apart — the one
	// job a session list has. Sessions started from the same opener share a title by design, so the
	// clock is what separates them; it is added only where a title actually repeats, so the common
	// case keeps the shorter, friendlier "yesterday".
	const titleCounts = shownSessions.reduce<Record<string, number>>((acc, h) => {
		acc[h.task] = (acc[h.task] ?? 0) + 1
		return acc
	}, {})
	const clockOf = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

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
			<div className="flex items-center gap-2">
				<div
					className="flex flex-1 items-center gap-2 rounded-md px-2 py-1"
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
				<button
					aria-label="Close"
					className="codicon codicon-close shrink-0 p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
					data-testid="entry-drawer-close"
					onClick={onClose}
					style={{ color: "var(--vscode-descriptionForeground)", fontSize: "13px" }}
				/>
			</div>

			<div className="flex-1 overflow-auto rounded-md" style={{ border: "1px solid var(--vscode-panel-border)" }}>
				{shownSessions.length > 0 && (
					<>
						<Group first={true} label={showAll || q ? `All sessions · ${sessions.length}` : "Recent sessions"} />
						{shownSessions.map((h) => (
							<Row
								icon="history"
								key={h.id}
								meta={[
									foldersDiffer ? folderOf(h) : "",
									ageLabel(h.ts, now),
									titleCounts[h.task] > 1 ? clockOf(h.ts) : "",
								]
									.filter(Boolean)
									.join(" · ")}
								onClick={() => openSession(h.id)}
								testId="entry-drawer-session"
								title={h.task}
							/>
						))}
						{!q && sessions.length > RECENT && (
							<button
								className="flex w-full flex-col py-2 pl-[41px] pr-3 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
								data-testid="entry-drawer-see-all"
								onClick={() => setShowAll(!showAll)}
								style={{ color: BRAND_CYAN_600, fontSize: "12px" }}>
								{showAll ? `Show just the recent ${RECENT}` : `See all ${sessions.length} sessions`}
								{/* Under the link. Pushed to its right, it landed beside a link that had already
								    wrapped and the two read as one garbled line. */}
								{!showAll && (
									<span style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px" }}>
										older runs, searchable
									</span>
								)}
							</button>
						)}
					</>
				)}

				{visibleRuns.length > 0 && (
					<>
						<Group first={!shownSessions.length} label="Suggested runs" />
						{visibleRuns.map((r) => (
							<Row
								icon={r.item.icon ?? "rocket"}
								key={r.item.id}
								meta={r.item.meta}
								onClick={() => run(r.item)}
								testId="entry-drawer-run"
								title={r.item.title}
								unseen={unseenRunIds.includes(r.item.id)}
								why={r.grounded ? r.why : undefined}
							/>
						))}
					</>
				)}

				{visibleChecks.length > 0 && (
					<>
						<Group label="Checks" />
						{visibleChecks.map((c) => (
							<Row
								icon={c.icon ?? "shield"}
								key={c.id}
								meta={c.meta}
								onClick={() => run(c)}
								testId="entry-drawer-check"
								title={c.title}
							/>
						))}
					</>
				)}

				{visibleSamples.length > 0 && (
					<>
						<Group label="Sample runs" />
						{visibleSamples.map((s) => (
							<Row
								icon={s.icon ?? "play-circle"}
								key={s.id}
								meta={s.meta ?? "~1 min · no hardware"}
								onClick={() => run(s)}
								testId="entry-drawer-sample"
								title={s.title}
							/>
						))}
					</>
				)}

				{/* An empty result has to offer the way out. [SCREENSHOT 2026-09-04] It said
				    'Nothing matches "zzzz".' into a panel-high empty box and stopped there: the only
				    escape was to go back and clear the field by hand, which is work the screen could
				    have done. It also now says WHAT was searched, so a miss reads as a real absence
				    rather than as a filter that might only cover the visible rows. */}
				{nothing && (
					<div
						className="flex flex-col items-start gap-2 px-3 py-4"
						style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px" }}>
						<span>No session, run or check matches “{query}”.</span>
						<button
							className="underline"
							onClick={() => {
								setQuery("")
								searchRef.current?.focus()
							}}
							style={{ color: BRAND_CYAN_600 }}>
							Clear the filter
						</button>
					</div>
				)}
			</div>

			<div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px" }}>
				<kbd>Esc</kbd> closes
			</div>
		</div>
	)
}

/** A section head with a rule running off it, so the groups read as bands rather than as three
 *  more grey lines in the same flat column. `first` drops the divider above the first band. */
const Group: React.FC<{ label: string; first?: boolean }> = ({ label, first }) => (
	<div
		className={`px-3 pb-1.5 uppercase ${first ? "pt-2" : "mt-1.5 pt-2.5"}`}
		style={{
			color: "var(--vscode-descriptionForeground)",
			fontSize: "10px",
			letterSpacing: "0.08em",
			borderTop: first ? undefined : "1px solid var(--vscode-panel-border)",
		}}>
		{label}
	</div>
)

/**
 * One row. An icon gutter, a title, and whatever is worth saying underneath.
 *
 * [OPERATOR 2026-09-04] "this looks unstructured and a plain list" — it was. Thirteen rows of the
 * same weight with no left edge to scan down, and `DrawerRun` had carried an `icon` from the start
 * ("so a card is recognisable before it is read") that this component never rendered. The gutter
 * is what turns a list into something you can skim: the eye tracks one column and the row types
 * separate themselves before any word is read.
 */
const Row: React.FC<{
	title: string
	icon?: string
	meta?: string
	why?: string
	unseen?: boolean
	onClick: () => void
	testId: string
}> = ({ title, icon, meta, why, unseen, onClick, testId }) => (
	<button
		className="flex w-full gap-2.5 px-3 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
		data-testid={testId}
		onClick={onClick}>
		<span
			aria-hidden="true"
			className={`codicon codicon-${icon ?? "circle-small-filled"} shrink-0`}
			style={{ fontSize: "14px", marginTop: "2px", opacity: 0.6, width: "16px" }}
		/>
		<span className="flex min-w-0 flex-1 flex-col gap-0.5">
			<span className="flex w-full items-baseline gap-2">
				<span className="truncate" style={{ color: "var(--vscode-foreground)", fontSize: "12.5px" }}>
					{title}
				</span>
				{unseen && (
					<span
						className="shrink-0"
						style={{
							fontSize: "9px",
							border: `1px solid ${BRAND_CORAL}`,
							color: BRAND_CORAL,
							borderRadius: "9px",
							padding: "0 5px",
						}}>
						new
					</span>
				)}
			</span>
			{/* Under the title, never beside it. [SCREENSHOT 2026-09-04] Sharing a baseline row with a
		    shrink-0 metadata column, the title took the whole squeeze and the sidebar showed three
		    sessions called "Fix …", "Step …" and "CRA…". */}
			{meta && <span style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px" }}>{meta}</span>}
			{/* Muted, not cyan. Cyan is the action colour; spending it on explanatory text that repeats
		    down the list made the least important words the loudest on the surface. */}
			{why && <span style={{ color: "var(--vscode-descriptionForeground)", fontSize: "10.5px" }}>{why}</span>}
		</span>
	</button>
)

export default EntryDrawer
