import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { VirtuosoHandle } from "react-virtuoso"
import { ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	task?: ClineMessage
	messages: ClineMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
	scrollBehavior: {
		scrollToBottomSmooth: () => void
		disableAutoScrollRef: React.MutableRefObject<boolean>
		showScrollToBottom: boolean
		virtuosoRef: React.RefObject<VirtuosoHandle>
	}
}

/**
 * Action buttons area including scroll-to-bottom and approve/reject buttons
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
	task,
	messages,
	chatState,
	mode,
	messageHandlers,
	scrollBehavior,
}) => {
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled } = chatState
	const [isProcessing, setIsProcessing] = useState(false)

	// Memoize last message to avoid unnecessary recalculations
	const lastMessage = useMemo(() => messages.at(-1), [messages])

	// Memoize button configuration to avoid recalculation on every render
	const buttonConfig = useMemo(() => {
		return lastMessage ? getButtonConfig(lastMessage, mode) : { sendingDisabled: false, enableButtons: false }
	}, [lastMessage, mode])

	// Single effect to handle all configuration updates
	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
		setIsProcessing(false)
	}, [buttonConfig, setSendingDisabled])

	// DELIBERATELY NOT CLEARING THE INPUT HERE.
	//
	// This used to wipe inputValue/images/files whenever the message list went
	// command_output(ask) → api_req_started(say). That transition says the AGENT moved on; it says
	// nothing about whether the DEVELOPER sent anything. Reported 2026-08-13: typing a message while a
	// command was running, then having an approval arrive, silently erased the half-written message.
	// Losing someone's typing is unrecoverable — there is no undo for a cleared textarea.
	//
	// Every path that actually sends already clears the box itself: handleSendMessage clears on
	// `messageSent` (command_output is one of the ask types it handles), and every button action ends
	// in clearInputState(). So this effect could only ever fire when nothing had been sent.

	const handleActionClick = useCallback(
		(action: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			if (isProcessing) {
				return
			}
			setIsProcessing(true)

			// Special handling for cancel action
			if (action === "cancel") {
				setIsProcessing(false)
			}

			messageHandlers.executeButtonAction(action, text, images, files)
		},
		[messageHandlers, isProcessing],
	)

	// Keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				messageHandlers.executeButtonAction("cancel")
			}
		},
		[messageHandlers],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	if (!task) {
		return null
	}

	const { showScrollToBottom, scrollToBottomSmooth, disableAutoScrollRef } = scrollBehavior

	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = primaryText || secondaryText
	const isStreaming = task.partial === true
	const canInteract = enableButtons && !isProcessing

	// At rest (no action buttons, already at the bottom) render NOTHING — the previous permanent
	// scroll-to-top strip was a full-width row of standing clutter in the input stack (operator flag);
	// the scrollbar/wheel covers scrolling up.
	if (!showScrollToBottom && !hasButtons) {
		return null
	}

	// Early return for scroll button to avoid unnecessary computation
	if (showScrollToBottom || !hasButtons) {
		const handleScrollToBottom = () => {
			scrollToBottomSmooth()
			disableAutoScrollRef.current = false
		}
		// Show scroll to top button when there are no action buttons
		const handleScrollToTop = () => {
			scrollBehavior.virtuosoRef.current?.scrollTo({
				top: 0,
				behavior: "smooth",
			})
			disableAutoScrollRef.current = true
			// Virtual rendering may not have all items rendered when at bottom,
			// so scroll again after a delay to ensure we reach the true top
			setTimeout(() => {
				scrollBehavior.virtuosoRef.current?.scrollTo({
					top: 0,
					behavior: "smooth",
				})
			}, 300)
		}

		return (
			<div className="flex px-3.5">
				<VSCodeButton
					appearance="icon"
					aria-label={showScrollToBottom ? "Scroll to bottom" : "Scroll to top"}
					className="text-lg text-(--vscode-primaryButton-foreground) bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_55%,transparent)] rounded-[3px] overflow-hidden cursor-pointer flex justify-center items-center flex-1 h-[25px] hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_90%,transparent)] active:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_70%,transparent)] border-0"
					onClick={showScrollToBottom ? handleScrollToBottom : handleScrollToTop}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							if (showScrollToBottom) {
								handleScrollToBottom()
							} else {
								handleScrollToTop()
							}
						}
					}}>
					{showScrollToBottom ? (
						<span className="codicon codicon-chevron-down" />
					) : (
						<span className="codicon codicon-chevron-up" />
					)}
				</VSCodeButton>
			</div>
		)
	}

	// Morphing send icon supersedes these rows (operator 0707, Claude Code-style): the streaming state's
	// lone wide "Cancel" is the input's stop icon now, and the lone wide "Resume Task" is the send arrow
	// (ChatView computes the morph from this same buttonConfig). Escape-to-cancel above keeps working —
	// these early returns sit after every hook. All other button states render unchanged.
	if (!primaryText && secondaryAction === "cancel") {
		return null
	}
	if (primaryText === "Resume Task" && !secondaryText) {
		return null
	}

	const opacity = canInteract || isStreaming ? 1 : 0.5

	return (
		<div className="flex px-3.5" style={{ opacity }}>
			{primaryText && primaryAction && (
				<VSCodeButton
					appearance="primary"
					className={secondaryText ? "flex-1 mr-[6px]" : "flex-2"}
					disabled={!canInteract}
					onClick={() => handleActionClick(primaryAction, inputValue, selectedImages, selectedFiles)}>
					{primaryText}
				</VSCodeButton>
			)}
			{secondaryText && secondaryAction && (
				<VSCodeButton
					appearance="secondary"
					className={primaryText ? "flex-1" : "flex-2"}
					disabled={!canInteract}
					onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}>
					{secondaryText}
				</VSCodeButton>
			)}
		</div>
	)
}
