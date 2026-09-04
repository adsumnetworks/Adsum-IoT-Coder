import React from "react"
import { useEntrySignals } from "./useEntrySignals"

/**
 * The label above the composer when no task is running.
 *
 * There is no "New session" button anywhere, because typing here already starts one — a button
 * beside the box would do the identical thing, and a person faced with two controls for one
 * action stops trusting either. What a button did give you was the *knowledge* that a new session
 * was what you were about to start, and that nothing already open would be lost. This line says
 * both, in the place the eye is already going.
 *
 * Claude Code settles the same question the same way: no session control, the composer labels
 * itself, and resuming is the explicit secondary act.
 *
 * There is no folder chip, and this is a correction rather than an omission. The design called for
 * one in multi-root windows, to retarget the next session — but the webview cannot retarget
 * anything: the host takes the FIRST workspace folder itself (`utils/path.ts:109`, `getCwd`) and
 * stamps it on the task. A chip offering a choice the host would then ignore is worse than no chip.
 * What a multi-root window does need is to know why one of its folders is named, so it gets a
 * sentence instead of a control.
 */

const EntryInputLabel: React.FC = () => {
	const { mode, scopeName, roots } = useEntrySignals()
	const hasEarlier = mode.inScopeCount > 0 || mode.elsewhereCount > 0

	return (
		<div
			className="flex flex-wrap items-center gap-x-1.5 px-3.5 pb-1 pt-2"
			data-testid="entry-input-label"
			style={{ fontSize: "10px", letterSpacing: "0.07em", color: "var(--vscode-descriptionForeground)" }}>
			<span className="uppercase">New session</span>
			{scopeName && (
				<>
					<span aria-hidden="true">·</span>
					<span className="uppercase">{scopeName}</span>
				</>
			)}
			{roots.length > 1 && (
				<span className="basis-full" style={{ textTransform: "none", letterSpacing: 0 }}>
					first of {roots.length} folders in this window
				</span>
			)}
			{/* basis-full, not another "· …" fragment. At sidebar width the tail wrapped anyway and
			    carried its separator to the head of the new line, which reads as a typo. Its own row
			    is what it wanted to be. */}
			{hasEarlier && (
				<span className="basis-full" style={{ textTransform: "none", letterSpacing: 0 }}>
					the last one stays in the menu
				</span>
			)}
		</div>
	)
}

export default EntryInputLabel
