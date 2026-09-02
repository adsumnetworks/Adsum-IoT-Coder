import type { ClineMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest, NewTaskRequest, QueueUserMessageRequest } from "@shared/proto/cline/task"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: ClineMessage[], chatState: ChatState): MessageHandlers {
	const { backgroundCommandRunning, queuedUserMessages } = useExtensionState()
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setSelectedImages,
		setSelectedFiles,
		setSendingDisabled,
		setEnableButtons,
		clineAsk,
		lastMessage,
		setQueueRefusal,
		nordicMode,
		setNordicMode,
		setNordicPhase,
	} = chatState

	// Handle sending a message
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// Scope enforcement removed to prevent UI freezing. The agent will handle off-topic requests via system prompt instructions.

			// Prepend the active quote if it exists
			if (activeQuote && hasContent) {
				const prefix = "[context] \n> "
				const formattedQuote = activeQuote
				const suffix = "\n[/context] \n\n"
				messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
			}

			if (hasContent) {
				console.log("[ChatView] handleSendMessage - Sending message:", messageToSend)
				let messageSent = false
				let queued = false

				if (messages.length === 0) {
					await TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: messageToSend,
							images,
							files,
						}),
					)
					messageSent = true
				} else if (clineAsk && lastMessage?.partial !== true) {
					// Non-partial only, matching pendingAskFrom on the host: a still-streaming ask has thrown
					// out of ask() before pWaitFor, so nothing is awaiting an answer yet. Answering one would
					// write the ask slot, be cleared when the ask completed, and vanish without a trace.
					// A message typed while the question is still arriving is queued instead, and stays visible.
					// For resume_task and resume_completed_task, use yesButtonClicked to match Resume button behavior
					// This ensures Enter key and Resume button work identically
					if (clineAsk === "resume_task" || clineAsk === "resume_completed_task") {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: messageToSend,
								images,
								files,
							}),
						)
						messageSent = true
					} else {
						// All other ask types use messageResponse
						switch (clineAsk) {
							case "followup":
							case "plan_mode_respond":
							case "tool":
							case "browser_action_launch":
							case "command":
							case "command_output":
							case "use_mcp_server":
							case "completion_result":
							case "mistake_limit_reached":
							case "api_req_failed":
							case "new_task":
							case "condense":
							case "report_bug":
							case "open_project":
								await TaskServiceClient.askResponse(
									AskResponseRequest.create({
										responseType: "messageResponse",
										text: messageToSend,
										images,
										files,
									}),
								)
								messageSent = true
								break
						}
					}
				} else {
					// A task is running and nothing is asking: queue the message for the next turn boundary.
					//
					// NEVER askResponse here. Nothing is awaiting an answer at this moment, so the text would
					// sit in the ask slot until the next ask() — a tool or command approval — returned
					// instantly with it as the answer, approving something the developer never saw. That is
					// exactly what this branch used to do; it was unreachable only because the composer was
					// disabled while the agent worked, which is the restriction this feature lifts.
					const result = await TaskServiceClient.queueUserMessage(
						QueueUserMessageRequest.create({ text: messageToSend, images, files }),
					).catch(() => undefined)

					if (result?.accepted) {
						messageSent = true
						queued = true
						setQueueRefusal(null)
					} else {
						// The draft stays in the box. A refused message must never be silently swallowed —
						// the developer would believe the agent had been told.
						setQueueRefusal(result?.reason || "unreachable")
					}
				}

				// Only clear input and disable UI if message was actually sent
				if (messageSent) {
					setInputValue("")
					setActiveQuote(null)
					setSelectedImages([])
					setSelectedFiles([])

					// A queued message did not start anything: the run is still going and the developer may
					// well want to queue another. Disabling the box here would re-create the problem this
					// feature exists to solve.
					if (!queued) {
						setSendingDisabled(true)
						setEnableButtons(false)
					}

					// Reset auto-scroll
					if ("disableAutoScrollRef" in chatState) {
						;(chatState as any).disableAutoScrollRef.current = false
					}
				}
			}
		},
		[
			messages.length,
			clineAsk,
			lastMessage,
			activeQuote,
			setInputValue,
			setActiveQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			setQueueRefusal,
			chatState,
			nordicMode,
		],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		setNordicMode(null)
		setNordicPhase("awaiting_mode")
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [setActiveQuote, setNordicMode, setNordicPhase])

	// Clear input state helper
	const clearInputState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles])

	// Execute button action based on type
	const executeButtonAction = useCallback(
		async (actionType: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()
			const hasContent = trimmedInput || (images && images.length > 0) || (files && files.length > 0)

			switch (actionType) {
				case "retry":
					// For API retry (api_req_failed), always send simple approval without content
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "yesButtonClicked",
						}),
					)
					clearInputState()
					break
				case "approve":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "reject":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "proceed":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "new_task":
					if (clineAsk === "new_task") {
						await TaskServiceClient.newTask(
							NewTaskRequest.create({
								text: lastMessage?.text,
								images: [],
								files: [],
							}),
						)
					} else {
						await startNewTask()
					}
					break

				case "cancel":
					if (backgroundCommandRunning) {
						await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({}))
					} else {
						// Anything the developer typed that has not been delivered comes back to them rather
						// than dying with the turn — stopping a run is not a decision to discard what you
						// were about to say. Only their own messages: a note sent over the seam belongs to
						// the driver who sent it and is not this box's to reclaim.
						const unsent = (queuedUserMessages ?? []).filter((m) => m.source === "composer")
						if (unsent.length > 0) {
							setInputValue((current) =>
								[current.trim(), ...unsent.map((m) => m.text)].filter(Boolean).join("\n\n"),
							)
							const images = unsent.flatMap((m) => m.images ?? [])
							const files = unsent.flatMap((m) => m.files ?? [])
							if (images.length > 0) {
								setSelectedImages((current) => [...current, ...images])
							}
							if (files.length > 0) {
								setSelectedFiles((current) => [...current, ...files])
							}
						}
						await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					}
					// Clear any pending state that might interfere with resume
					setSendingDisabled(false)
					setEnableButtons(true)
					setQueueRefusal(null)
					break

				case "utility":
					switch (clineAsk) {
						case "condense":
							await SlashServiceClient.condense(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "report_bug":
							await SlashServiceClient.reportBug(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "open_project":
							// The ask carries the absolute path. Opening reloads the window, which ends this
							// chat — it is already saved and reopens from History, which the message says.
							await FileServiceClient.openFolder(StringRequest.create({ value: lastMessage?.text ?? "" })).catch(
								(err) => console.error(err),
							)
							break
					}
					break
			}

			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			clineAsk,
			lastMessage,
			messages,
			clearInputState,
			handleSendMessage,
			startNewTask,
			chatState,
			backgroundCommandRunning,
			setSendingDisabled,
			setEnableButtons,
			setQueueRefusal,
			setInputValue,
			setSelectedImages,
			setSelectedFiles,
			queuedUserMessages,
		],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		executeButtonAction,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
