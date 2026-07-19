import type { ModelInfo } from "@shared/api"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { ApiHandler } from "../"
import type { ApiStream } from "../transform/stream"

/** What the developer is told when something genuinely needs a model and there is none. */
export const NEEDS_A_MODEL =
	"This workspace runs on your own coding agent — Adsum hands work over instead of calling a model. " +
	"Pick a card or hand the session over, or choose a model in Settings to run it here."

// "Your own coding agent" is a run-TARGET, not an inference backend, so there is no real context window
// to report. These figures exist only so the token/context UI can render a past session without dividing
// by zero; nothing is ever sent to a model through this handler.
const EXTERNAL_AGENT_MODEL_INFO: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
	description: "Work runs on your own coding agent. Adsum hands it over and records what comes back.",
}

/**
 * The provider that never calls a provider.
 *
 * This used to be a `throw` inside `buildApiHandler`, which meant a Task could not even be CONSTRUCTED
 * while "your own coding agent" was selected — so every past session in history became unopenable and
 * the field reported that nothing was clickable. Reading a record should never require inference.
 *
 * The backstop moves to where the risk actually is: `createMessage`. That is the call that would
 * otherwise have fallen through to the AnthropicHandler default and made keyless real API calls.
 * Constructing, rendering and re-reading a session are all safe and now all work.
 */
export class ExternalAgentHandler implements ApiHandler {
	getModel(): { id: string; info: ModelInfo } {
		return { id: "external-agent", info: EXTERNAL_AGENT_MODEL_INFO }
	}

	createMessage(_systemPrompt: string, _messages: ClineStorageMessage[]): ApiStream {
		throw new Error(NEEDS_A_MODEL)
	}
}
