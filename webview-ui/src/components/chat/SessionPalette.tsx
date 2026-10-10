import type { AdsumAccountState } from "@shared/adsumAccount"
import type React from "react"
import { useCallback, useState } from "react"
import { openSession } from "@/components/rail/openSession"
import Palette from "@/components/rail/Palette"
import { type Run, useRankedRuns } from "@/components/rail/useRankedRuns"
import { useExtensionState } from "@/context/ExtensionStateContext"
import GatePanel from "./welcome/GatePanel"
import RequestAccessForm from "./welcome/RequestAccessForm"
import { isRequestOnlyGroup, requestFamilyFor } from "./welcome/welcomeIntents"

export interface SessionPaletteProps {
	open: boolean
	onClose: () => void
	/** Whether this tab already has a task running. Empty, a picked row fills THIS tab's composer and
	 *  waits for Enter; with a task already under way, the same row opens a fresh tab instead, so a
	 *  running task is never interrupted by a pick made from its own palette. */
	hasTask: boolean
	/** Fills this tab's own composer and focuses it. Called only for a prefill/run row in an empty tab. */
	onPrefill: (text: string) => void
}

/**
 * [0.5 simple] The rail's own palette, reached from inside a session tab. SessionComposerFoot's
 * "Something else · ⌘K" and the session view's own ⌘K/Ctrl+K both open this; a picked row either fills
 * this tab (no task yet) or opens a fresh one (this tab already has one, or the row always fires, e.g.
 * a sample). A locked row goes through the very gate the rail uses — GatePanel and RequestAccessForm are
 * ordinary chat/welcome components, reachable from a session tab exactly as from the sidebar, so there is
 * no need for the Settings fallback here.
 */
const SessionPalette: React.FC<SessionPaletteProps> = ({ open, onClose, hasTask, onPrefill }) => {
	const { adsumAccount } = useExtensionState() as ReturnType<typeof useExtensionState> & {
		adsumAccount?: AdsumAccountState
	}
	const { all, suggested } = useRankedRuns()
	const [gateOpen, setGateOpen] = useState(false)
	const [requestingFamily, setRequestingFamily] = useState<string | null>(null)

	const runRow = useCallback(
		(run: Run) => {
			onClose()
			const firesNow = run.kind === "fire" || run.kind === "sample"
			if (!hasTask && !firesNow) {
				onPrefill(run.prompt)
				return
			}
			void openSession({ prompt: run.prompt, send: firesNow, title: run.title })
		},
		[hasTask, onClose, onPrefill],
	)

	const lockedRow = useCallback(
		(run: Run) => {
			onClose()
			if (!adsumAccount) {
				setGateOpen(true)
				return
			}
			if (isRequestOnlyGroup(run.entitlement)) {
				setRequestingFamily(requestFamilyFor(run.entitlement))
				return
			}
			setGateOpen(true)
		},
		[adsumAccount],
	)

	return (
		<>
			<Palette onClose={onClose} onLocked={lockedRow} onRun={runRow} open={open} runs={all} suggested={suggested} />
			<GatePanel onClose={() => setGateOpen(false)} open={gateOpen} surface="session" />
			<RequestAccessForm
				family={requestingFamily ?? undefined}
				onClose={() => setRequestingFamily(null)}
				open={!!requestingFamily}
			/>
		</>
	)
}

export default SessionPalette
