import { findLast } from "@shared/array"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { combineErrorRetryMessages } from "@shared/combineErrorRetryMessages"
import { combineHookSequences } from "@shared/combineHookSequences"
import type { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { BooleanRequest, StringRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import { collectSessionKbits } from "@/components/chat/task-header/KbitPill"
import { normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useShowNavbar } from "@/context/PlatformContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { Navbar } from "../menu/Navbar"
import AiLimitationsFooter from "./AiLimitationsFooter"
// Import utilities and hooks from the new structure
import {
	ActionButtons,
	CHAT_CONSTANTS,
	ChatLayout,
	convertHtmlToMarkdown,
	filterVisibleMessages,
	groupKbitCredits,
	groupLowStakesTools,
	groupMessages,
	InputSection,
	MessagesArea,
	TaskSection,
	useChatState,
	useMessageHandlers,
	useScrollBehavior,
} from "./chat-view"
import { getButtonConfig } from "./chat-view/shared/buttonConfig"
import { DEMO_SCENARIOS } from "./demoScenarios"
import FreeTierStrip from "./FreeTierStrip"
import AgentSessionView from "./handover/AgentSessionView"
import { NORDIC_MODES, type NordicModeId } from "./nordicModes"
import { handOverCard } from "./welcome/handOverCard"
import { useRunTarget } from "./welcome/useRunTarget"
import WelcomeView from "./welcome/WelcomeView"

interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
}

// Use constants from the imported module
const MAX_IMAGES_AND_FILES_PER_MESSAGE = CHAT_CONSTANTS.MAX_IMAGES_AND_FILES_PER_MESSAGE
const QUICK_WINS_HISTORY_THRESHOLD = 3

const ChatView = ({ isHidden, showAnnouncement, hideAnnouncement, showHistoryView }: ChatViewProps) => {
	const showNavbar = useShowNavbar()
	const {
		version,
		clineMessages: messages,
		taskHistory,
		apiConfiguration,
		telemetrySetting,
		mode,
		userInfo,
		currentFocusChainChecklist,
		hooksEnabled,
		setExpandTaskHeader,
		demoAutoStart,
		handoverUi,
	} = useExtensionState()
	const { target: runTarget } = useRunTarget()
	const isProdHostedApp = userInfo?.apiBaseUrl === "https://app.cline.bot"
	const shouldShowQuickWins = false

	//const task = messages.length > 0 ? (messages[0].say === "task" ? messages[0] : undefined) : undefined) : undefined
	const task = useMemo(() => messages.at(0), [messages]) // leaving this less safe version here since if the first message is not a task, then the extension is in a bad state and needs to be debugged (see Cline.abort)
	const modifiedMessages = useMemo(() => {
		const slicedMessages = messages.slice(1)
		// Only combine hook sequences if hooks are enabled
		const withHooks = hooksEnabled ? combineHookSequences(slicedMessages) : slicedMessages
		return combineErrorRetryMessages(combineApiRequests(combineCommandSequences(withHooks)))
	}, [messages, hooksEnabled])
	// has to be after api_req_finished are all reduced into api_req_started messages
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const lastApiReqTotalTokens = useMemo(() => {
		const getTotalTokensFromApiReqMessage = (msg: ClineMessage) => {
			if (!msg.text) {
				return 0
			}
			const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(msg.text)
			return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
		}
		const lastApiReqMessage = findLast(modifiedMessages, (msg) => {
			if (msg.say !== "api_req_started") {
				return false
			}
			return getTotalTokensFromApiReqMessage(msg) > 0
		})
		if (!lastApiReqMessage) {
			return undefined
		}
		return getTotalTokensFromApiReqMessage(lastApiReqMessage)
	}, [modifiedMessages])

	// Use custom hooks for state management
	const chatState = useChatState(messages)
	const {
		setInputValue,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		sendingDisabled,
		enableButtons,
		expandedRows,
		setExpandedRows,
		textAreaRef,
	} = chatState

	const { nordicPhase, setNordicPhase, nordicMode, setNordicMode } = chatState
	const [isDemoRun, setIsDemoRun] = useState(false)

	useEffect(() => {
		const handleCopy = async (e: ClipboardEvent) => {
			const targetElement = e.target as HTMLElement | null
			// If the copy event originated from an input or textarea,
			// let the default browser behavior handle it.
			if (
				targetElement &&
				(targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA" || targetElement.isContentEditable)
			) {
				return
			}

			if (window.getSelection) {
				const selection = window.getSelection()
				if (selection && selection.rangeCount > 0) {
					const range = selection.getRangeAt(0)
					const commonAncestor = range.commonAncestorContainer
					let textToCopy: string | null = null

					// Check if the selection is inside an element where plain text copy is preferred
					let currentElement =
						commonAncestor.nodeType === Node.ELEMENT_NODE
							? (commonAncestor as HTMLElement)
							: commonAncestor.parentElement
					let preferPlainTextCopy = false
					while (currentElement) {
						if (currentElement.tagName === "PRE" && currentElement.querySelector("code")) {
							preferPlainTextCopy = true
							break
						}
						// Check computed white-space style
						const computedStyle = window.getComputedStyle(currentElement)
						if (
							computedStyle.whiteSpace === "pre" ||
							computedStyle.whiteSpace === "pre-wrap" ||
							computedStyle.whiteSpace === "pre-line"
						) {
							// If the element itself or an ancestor has pre-like white-space,
							// and the selection is likely contained within it, prefer plain text.
							// This helps with elements like the TaskHeader's text display.
							preferPlainTextCopy = true
							break
						}

						// Stop searching if we reach a known chat message boundary or body
						if (
							currentElement.classList.contains("chat-row-assistant-message-container") ||
							currentElement.classList.contains("chat-row-user-message-container") ||
							currentElement.tagName === "BODY"
						) {
							break
						}
						currentElement = currentElement.parentElement
					}

					if (preferPlainTextCopy) {
						// For code blocks or elements with pre-formatted white-space, get plain text.
						textToCopy = selection.toString()
					} else {
						// For other content, use the existing HTML-to-Markdown conversion
						const clonedSelection = range.cloneContents()
						const div = document.createElement("div")
						div.appendChild(clonedSelection)
						const selectedHtml = div.innerHTML
						textToCopy = await convertHtmlToMarkdown(selectedHtml)
					}

					if (textToCopy !== null) {
						try {
							FileServiceClient.copyToClipboard(StringRequest.create({ value: textToCopy })).catch((err) => {
								console.error("Error copying to clipboard:", err)
							})
							e.preventDefault()
						} catch (error) {
							console.error("Error copying to clipboard:", error)
						}
					}
				}
			}
		}
		document.addEventListener("copy", handleCopy)

		return () => {
			document.removeEventListener("copy", handleCopy)
		}
	}, [])
	// Button state is now managed by useButtonState hook

	// handleFocusChange is already provided by chatState

	// Use message handlers hook
	const messageHandlers = useMessageHandlers(messages, chatState)

	// Send-icon morph (operator 0707, Claude Code-style): while streaming the lone wide "Cancel" row is
	// replaced by a stop icon on the input; a paused task's wide "Resume Task" row is replaced by the send
	// arrow (any typed text rides along as feedback). ActionButtons hides those two rows; every other
	// button state (Approve/Reject, Start New Task, …) is untouched.
	const lastMessageForMorph = messages.length > 0 ? messages[messages.length - 1] : undefined
	const morphConfig = lastMessageForMorph ? getButtonConfig(lastMessageForMorph, mode) : undefined
	const inputMorph: { kind: "stop" | "resume"; run: () => void } | undefined =
		morphConfig && !morphConfig.primaryText && morphConfig.secondaryAction === "cancel"
			? { kind: "stop", run: () => messageHandlers.executeButtonAction("cancel") }
			: morphConfig?.primaryText === "Resume Task" && !morphConfig.secondaryText && morphConfig.primaryAction
				? {
						kind: "resume",
						run: () =>
							messageHandlers.executeButtonAction(
								"proceed",
								chatState.inputValue,
								chatState.selectedImages,
								chatState.selectedFiles,
							),
					}
				: undefined

	// Handle Nordic mode selection (must be after messageHandlers)
	const handleModeSelect = useCallback(
		async (mode: NordicModeId) => {
			try {
				const modeConfig = NORDIC_MODES[mode]
				setIsDemoRun(false)
				setNordicMode(mode)
				setNordicPhase("active")

				// Send a concise task instruction - we rely on backend Markdown workflows for the logic.
				// Use the mode's own systemPrompt so this works for any platform (nRF or ESP).
				const taskPrompt = modeConfig.systemPrompt
				await messageHandlers.handleSendMessage(taskPrompt, [], [])
			} catch (error) {
				console.error("[ChatView] Failed to start Nordic task:", error)
				// Reset state to avoid stuck UI
				setNordicPhase("awaiting_mode")
				setNordicMode(null)
			}
		},
		[messageHandlers, setNordicMode, setNordicPhase],
	)

	const handleStartDemo = useCallback(
		async (scenarioId: string) => {
			const scenario = DEMO_SCENARIOS[scenarioId]
			if (!scenario) return
			try {
				setIsDemoRun(true)
				setNordicPhase("active")
				setExpandTaskHeader(false)
				await messageHandlers.handleSendMessage(scenario.taskPrompt, [], [])
			} catch (error) {
				console.error("[ChatView] Demo run failed:", error)
				setIsDemoRun(false)
				setNordicPhase("awaiting_mode")
			}
		},
		[messageHandlers, setNordicPhase, setExpandTaskHeader],
	)

	const handleStartTask = useCallback(
		async (text: string) => {
			// Provider "external-agent" (or conductor mode): a typed task is a mission for the developer's
			// coding agent, not an in-panel run — hand it over instead of starting a task that could never
			// call a model (mcp-sdk/13 D7; the factory guard would refuse it with an error otherwise).
			if (runTarget === "agent") {
				await handOverCard({ prompt: text })
				return
			}
			setNordicPhase("active")
			await messageHandlers.handleSendMessage(text, [], [])
		},
		[messageHandlers, setNordicPhase, runTarget],
	)

	// Auto-start the demo once when the host requests it (e.g. the first-run announcement toast CTA
	// set demoAutoStart, then revealed the sidebar). Goes through the normal handleStartDemo so
	// isDemoRun / nordicPhase are set correctly. The host clears demoAutoStart when the demo task
	// fires; the ref guards against a double-fire within this session.
	const demoAutoStartFiredRef = useRef(false)
	useEffect(() => {
		if (demoAutoStart && !task && !demoAutoStartFiredRef.current) {
			demoAutoStartFiredRef.current = true
			void handleStartDemo(demoAutoStart)
		}
	}, [demoAutoStart, task, handleStartDemo])

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, mode)
	}, [apiConfiguration, mode])

	const selectFilesAndImages = useCallback(async () => {
		try {
			const response = await FileServiceClient.selectFiles(
				BooleanRequest.create({
					value: selectedModelInfo.supportsImages,
				}),
			)
			if (
				response &&
				response.values1 &&
				response.values2 &&
				(response.values1.length > 0 || response.values2.length > 0)
			) {
				const currentTotal = selectedImages.length + selectedFiles.length
				const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - currentTotal

				if (availableSlots > 0) {
					// Prioritize images first
					const imagesToAdd = Math.min(response.values1.length, availableSlots)
					if (imagesToAdd > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...response.values1.slice(0, imagesToAdd)])
					}

					// Use remaining slots for files
					const remainingSlots = availableSlots - imagesToAdd
					if (remainingSlots > 0) {
						setSelectedFiles((prevFiles) => [...prevFiles, ...response.values2.slice(0, remainingSlots)])
					}
				}
			}
		} catch (error) {
			console.error("Error selecting images & files:", error)
		}
	}, [selectedModelInfo.supportsImages])

	const shouldDisableFilesAndImages = selectedImages.length + selectedFiles.length >= MAX_IMAGES_AND_FILES_PER_MESSAGE

	// Subscribe to show webview events from the backend
	useEffect(() => {
		const cleanup = UiServiceClient.subscribeToShowWebview(
			{},
			{
				onResponse: (event) => {
					// Only focus if not hidden and preserveEditorFocus is false
					if (!isHidden && !event.preserveEditorFocus) {
						textAreaRef.current?.focus()
					}
				},
				onError: (error) => {
					console.error("Error in showWebview subscription:", error)
				},
				onComplete: () => {
					console.log("showWebview subscription completed")
				},
			},
		)

		return cleanup
	}, [isHidden])

	// Set up addToInput subscription
	useEffect(() => {
		const cleanup = UiServiceClient.subscribeToAddToInput(
			{},
			{
				onResponse: (event) => {
					if (event.value) {
						setInputValue((prevValue) => {
							const newText = event.value
							const newTextWithNewline = newText + "\n"
							return prevValue ? `${prevValue}\n${newTextWithNewline}` : newTextWithNewline
						})
						// Add scroll to bottom after state update
						// Auto focus the input and start the cursor on a new line for easy typing
						setTimeout(() => {
							if (textAreaRef.current) {
								textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight
								textAreaRef.current.focus()
							}
						}, 0)
					}
				},
				onError: (error) => {
					console.error("Error in addToInput subscription:", error)
				},
				onComplete: () => {
					console.log("addToInput subscription completed")
				},
			},
		)

		return cleanup
	}, [])

	useMount(() => {
		// NOTE: the vscode window needs to be focused for this to work
		textAreaRef.current?.focus()
	})

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, sendingDisabled, enableButtons])

	const visibleMessages = useMemo(() => {
		return filterVisibleMessages(modifiedMessages)
	}, [modifiedMessages])

	const lastProgressMessageText = useMemo(() => {
		// First check if we have a current focus chain list from the extension state
		if (currentFocusChainChecklist) {
			return currentFocusChainChecklist
		}

		// Fall back to the last task_progress message if no state focus chain list
		const lastProgressMessage = [...modifiedMessages].reverse().find((message) => message.say === "task_progress")
		return lastProgressMessage?.text
	}, [modifiedMessages, currentFocusChainChecklist])

	const groupedMessages = useMemo(() => {
		// kbit credits group LAST so a turn's several bits collapse into one credit line
		return groupKbitCredits(groupLowStakesTools(groupMessages(visibleMessages)))
	}, [visibleMessages])

	// Bits credited this session — drives the header attribution pill + roster (design/01).
	const sessionKbits = useMemo(() => collectSessionKbits(modifiedMessages), [modifiedMessages])

	// Use scroll behavior hook
	const scrollBehavior = useScrollBehavior(messages, visibleMessages, groupedMessages, expandedRows, setExpandedRows)

	const placeholderText = useMemo(() => {
		if (nordicPhase === "awaiting_mode") {
			return "Select a mode to start..."
		}
		const text = task ? "Type a message..." : "Describe your nRF debugging task..."
		return text
	}, [task, nordicPhase])

	// No-ending sessions (operator direction, 1307): the phase NEVER flips to "task_complete" anymore. A
	// completion — whether the workflow's `<!--TASK_COMPLETE-->` marker or an attempt_completion — is a
	// HANDOFF rendered in-stream (see CompletionOutputRow); the input stays live and the developer keeps
	// moving inside the same session with every K-bit/T-bit reachable. The home cards are doors INTO the
	// house; the only door OUT is the "+" new-session button. The latch that used to live here swapped the
	// input bar for the post-task NextStepChooser cards — that "session over" theatre is what this removes.
	// ("task_complete" stays in the NordicChatPhase type for stability; nothing sets it.)

	// Reset the demo flag when returning to the welcome screen so stale state doesn't bleed onto the next session.
	useEffect(() => {
		if (!task && isDemoRun) {
			setIsDemoRun(false)
		}
	}, [task, isDemoRun])

	return (
		<ChatLayout isHidden={isHidden}>
			<div className="flex flex-col flex-1 overflow-hidden">
				{showNavbar && <Navbar />}
				<FreeTierStrip />
				{task ? (
					<TaskSection
						apiMetrics={apiMetrics}
						lastApiReqTotalTokens={lastApiReqTotalTokens}
						lastProgressMessageText={lastProgressMessageText}
						messageHandlers={messageHandlers}
						selectedModelInfo={{
							supportsPromptCache: selectedModelInfo.supportsPromptCache,
							supportsImages: selectedModelInfo.supportsImages || false,
						}}
						sessionKbits={sessionKbits}
						task={task}
					/>
				) : handoverUi?.strip ? (
					/* A session out with the developer's coding agent IS a session — it takes the chat
					   view exactly where a local run would, until it is returned (mockup mcp-sdk/12).
					   A local task still wins the slot: starting one never gets blocked by tracking. */
					<AgentSessionView />
				) : (
					<WelcomeView
						onSelectMode={handleModeSelect}
						onStartDemo={handleStartDemo}
						onStartTask={handleStartTask}
						onUpgradeDismiss={hideAnnouncement}
						showUpgradeCard={showAnnouncement}
					/>
				)}
				{task && (
					<MessagesArea
						chatState={chatState}
						// No-ending sessions: the post-task NextStepChooser footer is gone — a completion renders
						// in-stream as a handoff card and the conversation simply continues. (The persistent
						// AI-limitations disclaimer lives under the always-present input footer below.)
						groupedMessages={groupedMessages}
						messageHandlers={messageHandlers}
						modifiedMessages={modifiedMessages}
						scrollBehavior={scrollBehavior}
						task={task}
					/>
				)}
			</div>
			{task && (
				<footer className="bg-(--vscode-sidebar-background)" style={{ gridRow: "2" }}>
					{/* Auto-approve moved into the input's bottom controls row (AutoApproveChip in ChatTextArea)
					    — the full-width bar row here was standing clutter (operator 0707). */}
					<ActionButtons
						chatState={chatState}
						messageHandlers={messageHandlers}
						messages={messages}
						mode={mode}
						scrollBehavior={{
							scrollToBottomSmooth: scrollBehavior.scrollToBottomSmooth,
							disableAutoScrollRef: scrollBehavior.disableAutoScrollRef,
							showScrollToBottom: scrollBehavior.showScrollToBottom,
							virtuosoRef: scrollBehavior.virtuosoRef,
						}}
						task={task}
					/>
					<InputSection
						chatState={chatState}
						messageHandlers={messageHandlers}
						morph={inputMorph}
						placeholderText={placeholderText}
						scrollBehavior={scrollBehavior}
						selectFilesAndImages={selectFilesAndImages}
						shouldDisableFilesAndImages={shouldDisableFilesAndImages}
					/>
					{/* Persistent AI-limitations disclaimer — visible while the dev acts on the agent's output.
					    Kept per spec (design/13 A6); footprint minimized per operator direction 0707. */}
					<AiLimitationsFooter style={{ padding: "1px 14px 3px" }} />
				</footer>
			)}
		</ChatLayout>
	)
}

export default ChatView
