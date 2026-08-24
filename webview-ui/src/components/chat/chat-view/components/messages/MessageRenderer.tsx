import { ClineMessage } from "@shared/ExtensionMessage"
import React, { useMemo } from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { KbitCredit, type KbitLoadedPayload, parseKbitPayload } from "@/components/chat/KbitCredit"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { MessageHandlers } from "../../types/chatTypes"
import { findReasoningForApiReq, isKbitGroup, isTextMessagePendingToolCall, isToolGroup } from "../../utils/messageUtils"
import { ToolGroupRenderer } from "./ToolGroupRenderer"

interface MessageRendererProps {
	index: number
	messageOrGroup: ClineMessage | ClineMessage[]
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
}

/**
 * Specialized component for rendering different message types
 * Handles browser sessions, regular messages, and checkpoint logic
 */
export const MessageRenderer: React.FC<MessageRendererProps> = ({
	index,
	messageOrGroup,
	groupedMessages,
	modifiedMessages,
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onSetQuote,
	inputValue,
	messageHandlers,
}) => {
	const { mode } = useExtensionState()

	const isLastMessage = useMemo(() => index === groupedMessages?.length - 1, [groupedMessages, index])

	// Get reasoning content and response status for api_req_started messages
	const reasoningData = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "api_req_started") {
			// Use the same message source-of-truth that `groupedMessages` is derived from.
			return findReasoningForApiReq(messageOrGroup.ts, modifiedMessages)
		}
		return { reasoning: undefined, responseStarted: false, durationMs: undefined }
	}, [messageOrGroup, modifiedMessages])

	// Check if a text message is waiting for tool call completion
	const isRequestInProgress = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "text") {
			// Use modifiedMessages so this stays consistent with the rendered list.
			return isTextMessagePendingToolCall(messageOrGroup.ts, modifiedMessages)
		}
		return false
	}, [messageOrGroup, modifiedMessages])

	// Tool group (low-stakes tools grouped together)
	// Always render - the loading state in ChatRow shows current activities,
	// while ToolGroupRenderer shows what's in context. Overlap is fine.
	// Several bits loaded in one turn → ONE grouped credit line, never a stack (design/01 credit law).
	if (isKbitGroup(messageOrGroup)) {
		const bits = messageOrGroup.map((m) => parseKbitPayload(m.text)).filter((p): p is KbitLoadedPayload => p !== null)
		// ChatRow wraps every other row in a px-4 gutter. This path renders KbitCredit directly, so without
		// the same padding the credit mark alone sits flush against the panel edge while everything above and
		// below it is indented — which is exactly how it looked.
		return bits.length > 0 ? (
			<div className="px-4">
				<KbitCredit bits={bits} />
			</div>
		) : null
	}

	if (isToolGroup(messageOrGroup)) {
		return <ToolGroupRenderer allMessages={modifiedMessages} messages={messageOrGroup} />
	}

	// Browser session group
	if (Array.isArray(messageOrGroup)) {
		return (
			<BrowserSessionRow
				expandedRows={expandedRows}
				isLast={isLastMessage}
				key={messageOrGroup[0]?.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				messages={messageOrGroup}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
			/>
		)
	}

	// Regular message
	return (
		<div
			className={cn({
				"pb-2.5": isLastMessage,
			})}
			data-message-ts={messageOrGroup.ts}>
			<ChatRow
				inputValue={inputValue}
				isExpanded={expandedRows[messageOrGroup.ts] || false}
				isLast={isLastMessage}
				isRequestInProgress={isRequestInProgress}
				key={messageOrGroup.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				message={messageOrGroup}
				mode={mode}
				onCancelCommand={() => messageHandlers.executeButtonAction("cancel")}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
				reasoningContent={reasoningData.reasoning}
				reasoningDurationMs={reasoningData.durationMs}
				responseStarted={reasoningData.responseStarted}
				sendMessageFromChatRow={messageHandlers.handleSendMessage}
			/>
		</div>
	)
}

/**
 * Factory function to create the itemContent callback for Virtuoso
 * This allows us to encapsulate the rendering logic while maintaining performance
 */
export const createMessageRenderer = (
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
	expandedRows: Record<number, boolean>,
	onToggleExpand: (ts: number) => void,
	onHeightChange: (isTaller: boolean) => void,
	onSetQuote: (quote: string | null) => void,
	inputValue: string,
	messageHandlers: MessageHandlers,
) => {
	return (index: number, messageOrGroup: ClineMessage | ClineMessage[]) => (
		<MessageRenderer
			expandedRows={expandedRows}
			groupedMessages={groupedMessages}
			index={index}
			inputValue={inputValue}
			messageHandlers={messageHandlers}
			messageOrGroup={messageOrGroup}
			modifiedMessages={modifiedMessages}
			onHeightChange={onHeightChange}
			onSetQuote={onSetQuote}
			onToggleExpand={onToggleExpand}
		/>
	)
}
