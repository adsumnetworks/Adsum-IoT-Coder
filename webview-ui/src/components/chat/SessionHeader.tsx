import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { RenameTaskRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { R } from "@/components/rail/railStyles"
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
	const modelChip = isAdsumHosted ? "Adsum free" : `${selectedProvider} · ${selectedModelId}`
	const contextPercent =
		selectedModelInfo?.contextWindow && lastApiReqTotalTokens !== undefined
			? (lastApiReqTotalTokens / selectedModelInfo.contextWindow) * 100
			: undefined
	const journeyStep = findJourneyStep(messages)
	const showCost = isAdsumHosted && totalCost > 0

	if (view !== "session") {
		return null
	}

	return (
		<div className="flex flex-col gap-1" data-testid="session-header" style={{ padding: "6px 14px 2px" }}>
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
						style={R.title}
						type="button">
						{name}
					</button>
				)}
			</div>
			{journeyStep ? (
				<div data-testid="journey-step-banner" style={{ ...R.meta, color: BRAND_CORAL }}>
					Step {journeyStep.step} of {journeyStep.total}
				</div>
			) : null}
			<div className="flex items-center gap-2 flex-wrap" style={R.meta}>
				<span
					data-testid="model-chip"
					style={isAdsumHosted ? { color: BRAND_CYAN_TEXT } : undefined}
					title="provider · model">
					{modelChip}
				</span>
				{contextPercent !== undefined ? (
					<span data-testid="context-use" title="Context window used">
						{Math.round(contextPercent)}% context
					</span>
				) : null}
				{showCost ? <span data-testid="session-cost">${totalCost.toFixed(4)}</span> : null}
			</div>
		</div>
	)
}

export default SessionHeader
