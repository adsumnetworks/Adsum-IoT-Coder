import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { ClineAskResponse } from "@shared/WebviewMessage"
import type { HookExecution } from "./types/HookExecution"

export class TaskState {
	// Streaming flags
	isStreaming = false
	isWaitingForFirstChunk = false
	didCompleteReadingStream = false

	// Content processing
	currentStreamingContentIndex = 0
	assistantMessageContent: AssistantMessageContent[] = []
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam)[] = []
	userMessageContentReady = false
	// Map of tool names to their tool_use_id for creating proper ToolResultBlockParam
	toolUseIdMap: Map<string, string> = new Map()

	// Presentation locks
	presentAssistantMessageLocked = false
	presentAssistantMessageHasPendingUpdates = false

	// Ask/Response handling
	askResponse?: ClineAskResponse
	askResponseText?: string
	askResponseImages?: string[]
	askResponseFiles?: string[]
	lastMessageTs?: number

	// Plan mode specific state
	isAwaitingPlanResponse = false
	didRespondToPlanAskBySwitchingMode = false

	// Context and history
	conversationHistoryDeletedRange?: [number, number]

	// Tool execution flags
	didRejectTool = false
	didAlreadyUseTool = false
	didEditFile: boolean = false
	lastToolName: string = "" // Track last tool used for consecutive call detection

	// CRA funnel — fire each milestone once per task, keyed host-side on the output artifact path (the
	// path is never sent; payload is iot_platform only). See WriteToFileToolHandler.
	craSbomEmitted: boolean = false
	craFixEmitted: boolean = false

	// CRA completion seatbelt (design/31, from 2906c): set true once the readiness report passes the guarded
	// write_to_file seam. attempt_completion refuses to finish a CRA readiness run (posture preview presented
	// in chat) while this is false — the report must be a WRITTEN record, never a chat-only dump. A run that
	// blows context and inline-dumps the report instead of writing it (2906c) is the failure this prevents.
	craReadinessReportWritten: boolean = false

	// CRA twin seatbelt (parity, 2906i): directory of the readiness `.md` that cleared the write seam. The skeleton
	// mandates BOTH `CRA_READINESS.md` AND its machine-readable twin `cra-readiness.json` in the same folder — a real
	// ESP run wrote only the `.md`. attempt_completion checks this dir for the json twin and refuses to finish without
	// it. (The twin can't be enforced at `.md` write time — write order isn't fixed — so it's gated at completion.)
	craReadinessReportDir?: string

	// IoT-knowledge no-double-load guard: absolute paths of iot-knowledge skill
	// files already served via read_file this task. Re-reads return a short stub
	// instead of the full text (these files don't change during a task), saving
	// context. Complements the "already loaded" manifest in the system prompt.
	loadedKnowledgeFiles: Set<string> = new Set()

	// Error tracking
	consecutiveMistakeCount: number = 0
	didAutomaticallyRetryFailedApiRequest = false
	checkpointManagerErrorMessage?: string

	// One-shot UX notice when a low-tier model keeps producing malformed tool
	// calls. Set the first time we emit the "consider switching model" hint
	// so it doesn't spam every subsequent retry in the same task.
	didNotifyLowTierToolCallReliability: boolean = false

	// Retry tracking for auto-retry feature
	autoRetryAttempts: number = 0

	// Task Initialization
	isInitialized = false

	// Focus Chain / Todo List Management
	apiRequestCount: number = 0
	apiRequestsSinceLastTodoUpdate: number = 0
	currentFocusChainChecklist: string | null = null
	todoListWasUpdatedByUser: boolean = false

	// Task Abort / Cancellation
	abort: boolean = false
	didFinishAbortingStream = false
	abandoned = false

	// Hook execution tracking for cancellation
	activeHookExecution?: HookExecution

	// Auto-context summarization
	currentlySummarizing: boolean = false
	lastAutoCompactTriggerIndex?: number
}
