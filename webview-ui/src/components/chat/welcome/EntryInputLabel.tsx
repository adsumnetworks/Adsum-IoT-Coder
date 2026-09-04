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
 * The folder chip appears only when more than one folder is open. In a single-folder window it
 * would be a control that cannot act.
 */

interface EntryInputLabelProps {
	/** Multi-root only: called when the developer retargets the next session. */
	onPickScope?: () => void
}

const EntryInputLabel: React.FC<EntryInputLabelProps> = ({ onPickScope }) => {
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
					{roots.length > 1 && onPickScope ? (
						<button
							className="rounded-full px-1.5 hover:underline"
							data-testid="entry-scope-chip"
							onClick={onPickScope}
							style={{ border: "1px solid var(--vscode-panel-border)", letterSpacing: 0 }}
							title="Which folder the next session belongs to">
							◆ {scopeName} ▾
						</button>
					) : (
						<span className="uppercase">{scopeName}</span>
					)}
				</>
			)}
			{hasEarlier && <span style={{ textTransform: "none", letterSpacing: 0 }}>· the last one stays in the menu</span>}
		</div>
	)
}

export default EntryInputLabel
