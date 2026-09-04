import React from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	/** Send-icon morph (stop while streaming / resume on a paused task) — computed in ChatView. */
	morph?: { kind: "stop" | "resume"; run: () => void }
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
	morph,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
		nordicPhase,
		task,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior

	// Freeze input while a mode is genuinely being awaited — which can only be INSIDE a task.
	//
	// [OPERATOR 2026-09-04] "I still can't send any text from the main window", after the send
	// flag was fixed. This was the second gate: `nordicPhase` starts life as "awaiting_mode" and
	// only leaves it once a task has more than one message. On the entry surface there is no task
	// and no message, so the composer that IS the new session sat frozen by a rule written for a
	// mode chooser that never appears there. Same lesson as the send flag: a state with no owner
	// in the no-task case has to be answered by the expression, not by whichever component
	// happens to be mounted.
	const isInputFrozen = !!task && nordicPhase === "awaiting_mode"
	const effectiveSendingDisabled = sendingDisabled || isInputFrozen

	return (
		<>
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			<div style={{ opacity: isInputFrozen ? 0.5 : 1 }}>
				<ChatTextArea
					activeQuote={activeQuote}
					inputValue={inputValue}
					morph={morph}
					onFocusChange={handleFocusChange}
					onHeightChange={() => {
						if (isAtBottom) {
							scrollToBottomAuto()
						}
					}}
					onSelectFilesAndImages={selectFilesAndImages}
					onSend={() => messageHandlers.handleSendMessage(inputValue, selectedImages, selectedFiles)}
					placeholderText={placeholderText}
					ref={textAreaRef}
					selectedFiles={selectedFiles}
					selectedImages={selectedImages}
					sendingDisabled={effectiveSendingDisabled}
					setInputValue={setInputValue}
					setSelectedFiles={setSelectedFiles}
					setSelectedImages={setSelectedImages}
					shouldDisableFilesAndImages={shouldDisableFilesAndImages}
				/>
			</div>
		</>
	)
}
