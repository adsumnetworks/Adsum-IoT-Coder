import type { ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useState } from "react"
import { R } from "@/components/rail/railStyles"
import type { FoldedRow } from "@/utils/foldRows"

export interface FoldedToolRowProps {
	row: FoldedRow
	/** Renders one raw message exactly as the rest of the transcript would. Kept generic so this
	 *  component carries no knowledge of ChatRow's own, much larger, per-say/per-ask switch. */
	renderMessage: (message: ClineMessage) => React.ReactNode
}

const ASK_SAY = new Set(["error", "diff_error", "clineignore_error", "mistake_limit_reached"])

/**
 * [P4.2 sessions first] One worklog line per folded tool/command/kbit run. Collapsed by default; a click
 * expands it to the raw rows underneath, and collapsing again never deletes them — it is a view toggle on
 * the same `row.messages`, nothing more. A standalone row (an ask, an error, or anything foldRows left
 * untouched) always renders in full: those are the exception path, never a line in a worklog.
 */
const FoldedToolRow: React.FC<FoldedToolRowProps> = ({ row, renderMessage }) => {
	const isException = row.kind === "single" && (row.message.type === "ask" || ASK_SAY.has(row.message.say ?? ""))
	const [expanded, setExpanded] = useState(isException)

	if (row.kind === "single") {
		return <>{renderMessage(row.message)}</>
	}

	return (
		<div className="px-4" data-testid="folded-tool-row">
			<button
				aria-expanded={expanded}
				className="flex items-center gap-1.5 bg-transparent border-0 p-0 cursor-pointer text-left w-full"
				data-testid="folded-tool-row-toggle"
				onClick={() => setExpanded((e) => !e)}
				style={{ ...R.meta, padding: "2px 0" }}
				type="button">
				<span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
				<span>{row.label}</span>
			</button>
			{expanded ? (
				<div className="flex flex-col" data-testid="folded-tool-row-detail">
					{row.messages.map((m) => (
						<div key={m.ts}>{renderMessage(m)}</div>
					))}
				</div>
			) : null}
		</div>
	)
}

export default FoldedToolRow
