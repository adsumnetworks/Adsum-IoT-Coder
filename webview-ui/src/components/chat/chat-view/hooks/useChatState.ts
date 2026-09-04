import { ClineMessage } from "@shared/ExtensionMessage"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { NordicChatPhase, NordicModeId } from "../../nordicModes"
import { ChatState } from "../types/chatTypes"

/**
 * Custom hook for managing chat state
 * Handles input values, selection states, and UI state
 */
export function useChatState(messages: ClineMessage[]): ChatState {
	// Input and selection state
	const [inputValue, setInputValue] = useState("")
	const [activeQuote, setActiveQuote] = useState<string | null>(null)
	const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])
	const [selectedFiles, setSelectedFiles] = useState<string[]>([])

	// UI state
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>("Approve")
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>("Reject")
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	// Why a message could not be queued. Shown beside the box, which keeps the text either way.
	const [queueRefusal, setQueueRefusal] = useState<string | null>(null)

	// Nordic mode state
	const [nordicMode, setNordicMode] = useState<NordicModeId | null>(null)
	const [nordicPhase, setNordicPhase] = useState<NordicChatPhase>("awaiting_mode")

	// Refs
	const textAreaRef = useRef<HTMLTextAreaElement>(null)

	// Derived state
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])
	const clineAsk = useMemo(() => (lastMessage?.type === "ask" ? lastMessage.ask : undefined), [lastMessage])

	// Clear expanded rows when task changes
	const task = useMemo(() => messages.at(0), [messages])
	const clearExpandedRows = useCallback(() => {
		setExpandedRows({})
	}, [])

	// Reset state when starting new conversation
	const resetState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
		setNordicMode(null)
		setNordicPhase("awaiting_mode")
		setQueueRefusal(null)
	}, [])

	// Handle focus change
	const handleFocusChange = useCallback((isFocused: boolean) => {
		setIsTextAreaFocused(isFocused)
	}, [])

	// Auto-expand last message row when task or messages first changed.
	useEffect(() => {
		clearExpandedRows()
	}, [task?.ts, clearExpandedRows])

	// When loading a historical or completed task (messages already exist),
	// transition nordicPhase out of "awaiting_mode" so the input is not frozen.
	useEffect(() => {
		if (nordicPhase === "awaiting_mode" && messages.length > 1) {
			setNordicPhase("active")
		}
	}, [messages.length, nordicPhase])

	return {
		// State values
		inputValue,
		setInputValue,
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		setIsTextAreaFocused,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		// Derived, not the raw flag. With no task there is nothing in flight, so sending CANNOT be
		// disabled — and the raw flag has no owner in that state to say so.
		//
		// [OPERATOR 2026-09-04] "there is like a no parking sign when I try to hit send", and there
		// was: `cursor: not-allowed` on a send button whose `disabled` was stuck true. The only
		// writer of this flag is ActionButtons, which renders ONLY while a task exists. Finish a
		// task, return to the entry surface, and the writer has already unmounted holding the last
		// value it set — nothing left to reset it, and the composer is dead until a reload.
		//
		// This was latent until the composer began rendering without a task; before that the flag
		// was only ever read in the same condition that mounted its writer. Deriving it means the
		// invariant cannot rot again: the no-task case is answered by the expression, not by
		// whichever component happens to still be mounted.
		sendingDisabled: task ? sendingDisabled : false,
		setSendingDisabled,
		enableButtons,
		setEnableButtons,
		primaryButtonText,
		setPrimaryButtonText,
		secondaryButtonText,
		setSecondaryButtonText,
		expandedRows,
		setExpandedRows,
		queueRefusal,
		setQueueRefusal,

		// Refs
		textAreaRef,

		// Derived values
		lastMessage,
		secondLastMessage,
		clineAsk,
		task,

		// Handlers
		handleFocusChange,
		clearExpandedRows,
		resetState,

		// Nordic mode
		nordicMode,
		setNordicMode,
		nordicPhase,
		setNordicPhase,
	}
}
