import { ClineMessage } from "@shared/ExtensionMessage"
import React from "react"
import type { KbitLoadedPayload } from "@/components/chat/KbitCredit"
import TaskHeader from "@/components/chat/task-header/TaskHeader"
import { MessageHandlers } from "../../types/chatTypes"

interface TaskSectionProps {
	task: ClineMessage
	apiMetrics: {
		totalTokensIn: number
		totalTokensOut: number
		totalCacheWrites?: number
		totalCacheReads?: number
		totalCost: number
	}
	lastApiReqTotalTokens?: number
	selectedModelInfo: {
		supportsPromptCache: boolean
		supportsImages: boolean
	}
	messageHandlers: MessageHandlers
	lastProgressMessageText?: string
	/** Knowledge/Tool bits credited this session — drives the header attribution pill (design/01). */
	sessionKbits?: KbitLoadedPayload[]
}

/**
 * Task section shown when there's an active task
 * Includes the task header and manages task-specific UI
 */
export const TaskSection: React.FC<TaskSectionProps> = ({
	task,
	apiMetrics,
	lastApiReqTotalTokens,
	selectedModelInfo,
	messageHandlers,
	lastProgressMessageText,
	sessionKbits,
}) => {
	return (
		<TaskHeader
			cacheReads={apiMetrics.totalCacheReads}
			cacheWrites={apiMetrics.totalCacheWrites}
			doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
			lastApiReqTotalTokens={lastApiReqTotalTokens}
			lastProgressMessageText={lastProgressMessageText}
			onClose={messageHandlers.handleTaskCloseButtonClick}
			onSendMessage={messageHandlers.handleSendMessage}
			sessionKbits={sessionKbits}
			task={task}
			tokensIn={apiMetrics.totalTokensIn}
			tokensOut={apiMetrics.totalTokensOut}
			totalCost={apiMetrics.totalCost}
		/>
	)
}
