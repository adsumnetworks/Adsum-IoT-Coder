import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { RenameTaskRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { R } from "@/components/rail/railStyles"
import Truncate from "@/components/common/Truncate"
import { normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { ADSUM_VIEW } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { findJourneyStep } from "@/utils/journeyStep"
import { BRAND_CORAL, BRAND_CYAN_TEXT } from "./brandColors"

export interface SessionHeaderProps {
	task: ClineMessage
	messages: ClineMessage[]
	currentTaskItem?: HistoryItem
	lastApiReqTotalTokens?: number
	totalCost: number
	/** Defaults to the real `ADSUM_VIEW`; a story or a test sets it directly. */
	view?: "sidebar" | "session"
}

/**
 * [P4.1 sessions first] The session tab's own header line — title, the journey step banner when the
 * model's latest reply carries one, the model chip, context-use, and a cost that only ever appears when
 * Adsum itself ran the tokens (the free tier). A BYOK key is the developer's own account, billed by their
 * own provider, so a dollar figure here would be Adsum claiming a spend it never made.
 */
const SessionHeader: React.FC<SessionHeaderProps> = ({
	task,
	messages,
	currentTaskItem,
	lastApiReqTotalTokens,
	totalCost,
	view = ADSUM_VIEW,
}) => {
	const { apiConfiguration, mode } = useExtensionState()

	// Same naming rule as HistoryViewItem/RailSessions: the developer's own name wins, else the first
	// prompt. `currentTaskItem.task` (not `.title`) is what rename never touches and search still matches.
	const name = currentTaskItem?.title?.trim() || currentTaskItem?.task || task.text || "Untitled session"
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(name)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus()
			inputRef.current?.select()
		}
	}, [editing])

	const commitRename = () => {
		setEditing(false)
		const next = draft.trim()
		const taskId = currentTaskItem?.id
		if (taskId && next && next !== name) {
			TaskServiceClient.renameTask(RenameTaskRequest.create({ taskId, title: next })).catch((error) =>
				console.error("Error renaming session:", error),
			)
		}
	}

	const { selectedProvider, selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	// "adsum-free" is the one provider the developer never picked by name — the inference Adsum itself
	// pays for. Everything else, including a hosted model reached through a developer's own key, is BYOK.
	const isAdsumHosted = selectedProvider === "adsum-free"
	// The model name only matters on BYOK — the developer picked it. On the free tier Adsum picks the
	// model, so naming it would be an answer to a question nobody there is asking.
	const tierLabel = isAdsumHosted ? "Adsum free" : selectedModelId
	const contextPercent =
		selectedModelInfo?.contextWindow && lastApiReqTotalTokens !== undefined
			? (lastApiReqTotalTokens / selectedModelInfo.contextWindow) * 100
			: undefined
	const journeyStep = findJourneyStep(messages)
	// On the free tier the developer pays nothing, so a dollar figure there would be Adsum claiming a
	// spend it never asked them for — tokens are the honest unit. On BYOK the key is the developer's own
	// account, billed by their own provider, so the cost is real and worth keeping — but only once that
	// provider actually reports one; a provider that never returns a cost should not show a stale "$0".
	const showTokens = isAdsumHosted && lastApiReqTotalTokens !== undefined
	const showCost = !isAdsumHosted && totalCost > 0

	if (view !== "session") {
		return null
	}

	return (
		<div className="flex flex-col gap-0.5" data-testid="session-header" style={{ padding: "6px 14px 2px" }}>
			<div className="flex items-center justify-between gap-2">
				{editing ? (
					<input
						aria-label="Session name"
						className="flex-1 bg-transparent outline-none min-w-0"
						data-testid="session-header-title-input"
						onBlur={commitRename}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								commitRename()
							} else if (e.key === "Escape") {
								setDraft(name)
								setEditing(false)
							}
						}}
						ref={inputRef}
						style={{ ...R.title, borderBottom: "1px solid var(--vscode-focusBorder)" }}
						value={draft}
					/>
				) : (
					<button
						aria-label="Rename session"
						className="bg-transparent border-0 p-0 cursor-pointer text-left truncate min-w-0"
						data-testid="session-header-title"
						onClick={() => {
							setDraft(name)
							setEditing(true)
						}}
						style={{ display: "block", width: "100%" }}
						type="button">
						<Truncate style={R.title} text={name} />
					</button>
				)}
			</div>
			{/* One meta line, not a stack of them: the journey step, the tier (or model, BYOK only), the
			    context-use percentage, and tokens or cost — whichever of those apply, in that order. */}
			<div className="flex items-center gap-1 min-w-0" data-testid="session-meta" style={R.meta}>
				{journeyStep ? (
					<>
						<span data-testid="journey-step-banner" style={{ color: BRAND_CORAL }}>
							Step {journeyStep.step} of {journeyStep.total}
						</span>
						<span aria-hidden="true">·</span>
					</>
				) : null}
				<span data-testid="model-chip" style={isAdsumHosted ? { color: BRAND_CYAN_TEXT } : undefined} title="model">
					{tierLabel}
				</span>
				{contextPercent !== undefined ? (
					<>
						<span aria-hidden="true">·</span>
						<span data-testid="context-use" title="Context window used">
							{Math.round(contextPercent)}% context
						</span>
					</>
				) : null}
				{showTokens ? (
					<>
						<span aria-hidden="true">·</span>
						<span data-testid="session-tokens" title="Tokens run on Adsum's own inference">
							{formatTokensShort(lastApiReqTotalTokens as number)} tokens
						</span>
					</>
				) : null}
				{showCost ? (
					<>
						<span aria-hidden="true">·</span>
						<span data-testid="session-cost">${totalCost.toFixed(4)}</span>
					</>
				) : null}
			</div>
		</div>
	)
}

/** "48000" → "48k"; under 1000, the plain number. One decimal only when it is not a whole k. */
function formatTokensShort(tokens: number): string {
	if (tokens < 1000) {
		return `${Math.round(tokens)}`
	}
	const k = tokens / 1000
	return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`
}

export default SessionHeader
