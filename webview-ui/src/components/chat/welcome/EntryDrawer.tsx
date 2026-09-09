import React, { useEffect, useRef, useState } from "react"
import { BRAND_CORAL, BRAND_CYAN_TEXT } from "../brandColors"
import AccountChip from "./AccountChip"
import type { Ranked, Suggestable } from "./suggest"

/**
 * The drawer — every run that is not on the entry surface right now, one click away.
 *
 * Sessions are NOT here. [OPERATOR 2026-09-09, approved] They were, from 2026-09-04, on the
 * belief that "the history view isn't there any more" — it is: the host's ↺ title action opens
 * HistoryView on the entry surface and mid-task alike (clicked and read in the sandbox before this
 * cut). A second session list, with its own rename and delete, was a second home for one thing
 * and the ☰ that opened it was a second menu icon 30 px under the host's own. Rename moved to
 * HistoryView with the list, so nothing the operator asked for on 09-04 is lost.
 *
 * Depth, not a second screen: the same ranked runs the cards come from, then checks, then the
 * sample runs — filtered together, because a filter that searched only part of the drawer would
 * be lying.
 */

export interface DrawerRun extends Suggestable {
	title: string
	/** The intent's own codicon, so a card is recognisable before it is read. */
	icon?: string
	blurb?: string
	meta?: string
	onRun: () => void
	/** Held behind an entitlement the account does not have. Rendered with a lock and the pill's
	 *  words ("Register" / "Request access"); running it opens the gate instead of the run. */
	locked?: boolean
	lockPill?: string
}

interface EntryDrawerProps {
	open: boolean
	onClose: () => void
	/** Ranked suggested runs — same list the entry cards come from, same order, one name. */
	runs: Ranked<DrawerRun>[]
	checks: DrawerRun[]
	samples: DrawerRun[]
	/** Marks a run the developer has never opened; clears when the drawer opens. */
	unseenRunIds?: string[]
}

const EntryDrawer: React.FC<EntryDrawerProps> = ({ open, onClose, runs, checks, samples, unseenRunIds = [] }) => {
	const [query, setQuery] = useState("")
	const searchRef = useRef<HTMLInputElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	/** What had focus before the drawer opened, so closing can hand it back. */
	const returnFocusRef = useRef<HTMLElement | null>(null)

	// Opening resets the filter: a drawer that remembers a stale search looks broken.
	useEffect(() => {
		if (open) {
			// Remember where focus came from. Closing a dialog without handing it back drops the
			// caret at the top of the document, which is disorienting exactly for the people who
			// rely on the keyboard — the same people the trap above is for.
			returnFocusRef.current = document.activeElement as HTMLElement | null
			setQuery("")
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

	const visibleRuns = runs.filter((r) => match(r.item.title + " " + (r.item.blurb ?? "")))
	const visibleChecks = checks.filter((c) => match(c.title + " " + (c.blurb ?? "")))
	const visibleSamples = samples.filter((s) => match(s.title + " " + (s.blurb ?? "")))
	const nothing = !visibleRuns.length && !visibleChecks.length && !visibleSamples.length

	if (!open) return null

	const run = (r: DrawerRun) => {
		r.onRun()
		onClose()
	}
	return (
		<div
			aria-label="Browse runs"
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
						aria-label="Filter runs and checks"
						className="flex-1 bg-transparent outline-none"
						data-testid="entry-drawer-filter"
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Filter runs and checks…"
						ref={searchRef}
						style={{ color: "var(--vscode-foreground)", fontSize: "12px" }}
						value={query}
					/>
				</div>
				{/* Who is signed in.
				    [SWEEP 2026-09-09] It used to sit inside the ENVIRONMENT caption on the entry
				    surface. Environment is what this MACHINE has — toolchains, boards, the folder — and
				    an account is not any of those; it is who you are, checked rarely, and it was taking
				    a permanent slot in the one band a developer reads for hardware. Here it is beside
				    the other things you go looking for rather than read. */}
				<AccountChip />
				<button
					aria-label="Close"
					// [SWEEP 2026-09-04, F14] A <button> brings its own grey fill, so the icon rendered as a
					// filled square beside the filter. Bare icon; the hover fill is the only background.
					className="codicon codicon-close shrink-0 rounded border-0 bg-transparent p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
					data-testid="entry-drawer-close"
					onClick={onClose}
					style={{ color: "var(--vscode-descriptionForeground)", fontSize: "13px" }}
				/>
			</div>

			{/* [F14] Sized to its rows, capped by the panel — not stretched to the panel. Three rows in a
			    frame the height of the whole sidebar read as an empty page with a list at the top. */}
			<div className="min-h-0 overflow-auto rounded-md" style={{ border: "1px solid var(--vscode-panel-border)" }}>
				{visibleRuns.length > 0 && (
					<>
						<Group first={true} label="Suggested runs" />
						{visibleRuns.map((r) => (
							<Row
								icon={r.item.locked ? "lock" : (r.item.icon ?? "rocket")}
								key={r.item.id}
								meta={r.item.locked ? (r.item.lockPill ?? "Register") : r.item.meta}
								onClick={() => run(r.item)}
								testId={r.item.locked ? "entry-drawer-run-locked" : "entry-drawer-run"}
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
						<Group label="Sample runs" sub="About a minute each · nothing to install" />
						{visibleSamples.map((s) => (
							<Row
								icon={s.icon ?? "play-circle"}
								key={s.id}
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
						<span>No run or check matches “{query}”.</span>
						<button
							className="underline"
							onClick={() => {
								setQuery("")
								searchRef.current?.focus()
							}}
							style={{ color: BRAND_CYAN_TEXT }}>
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
const Group: React.FC<{ label: string; first?: boolean; sub?: string }> = ({ label, first, sub }) => (
	<div
		className={`px-3 pb-1.5 ${first ? "pt-2" : "mt-1.5 pt-2.5"}`}
		style={{
			color: "var(--vscode-descriptionForeground)",
			borderTop: first ? undefined : "1px solid var(--vscode-panel-border)",
		}}>
		<div className="uppercase" style={{ fontSize: "10px", letterSpacing: "0.08em" }}>
			{label}
		</div>
		{/* One line for what every row in the band shares, so the rows do not each repeat it. */}
		{sub && <div style={{ fontSize: "11px" }}>{sub}</div>}
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
				<span
					style={{
						color: "var(--vscode-foreground)",
						fontSize: "12px",
						display: "-webkit-box",
						WebkitLineClamp: 2,
						WebkitBoxOrient: "vertical",
						overflow: "hidden",
					}}>
					{title}
				</span>
				{unseen && (
					<span
						className="shrink-0"
						style={{
							fontSize: "10px",
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
			{why && <span style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px" }}>{why}</span>}
		</span>
	</button>
)

export default EntryDrawer
