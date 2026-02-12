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
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior

	// Freeze input when awaiting mode selection
	const isInputFrozen = nordicPhase === "awaiting_mode"
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
