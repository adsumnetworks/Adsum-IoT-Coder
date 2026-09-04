import React, { useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import EntryDrawer from "./EntryDrawer"
import { entryDrawerOpen } from "./entryTelemetry"

/**
 * The ☰ door to sessions, for the surfaces that are not the entry cockpit.
 *
 * [OPERATOR 2026-09-04] "can you add the burger icon back". It was my omission: plan A.0 removed
 * the ⟲ history icon from the chat header on the grounds that "☰ takes that slot", and then ☰ was
 * only ever built into `WelcomeView`. `WelcomeView` unmounts the moment a task starts, so from
 * inside a session there was no way to reach any other session at all — the one home had no door
 * on the screen people spend their time on.
 *
 * Sessions only, deliberately. The cockpit's drawer also carries suggested runs, checks and
 * samples because on that screen every one of them is a way to *begin*. Mid-task they are ways to
 * abandon what is running, offered next to it — so this instance passes them empty, which the
 * drawer already renders correctly (it is the same state as a cold start with no history).
 */
const SessionsMenu: React.FC = () => {
	const { taskHistory } = useExtensionState()
	const [open, setOpen] = useState(false)
	const burgerRef = useRef<HTMLButtonElement>(null)

	return (
		<>
			<button
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label="Browse sessions"
				className="rounded px-1.5 py-0.5 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
				data-testid="session-burger"
				onClick={() => {
					entryDrawerOpen(false)
					setOpen(true)
				}}
				ref={burgerRef}
				style={{ background: "none", border: "none", cursor: "pointer", color: "var(--vscode-descriptionForeground)" }}
				title="Browse sessions">
				<span aria-hidden="true" className="codicon codicon-menu" />
			</button>
			<EntryDrawer
				checks={[]}
				history={taskHistory ?? []}
				onClose={() => setOpen(false)}
				open={open}
				runs={[]}
				samples={[]}
				unseenRunIds={[]}
			/>
		</>
	)
}

export default SessionsMenu
