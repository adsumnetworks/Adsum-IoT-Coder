import LengthFinishReasonError, { APIError } from "openai"

export function checkContextWindowExceededError(error: unknown): boolean {
	return (
		checkIsOpenAIContextWindowError(error) ||
		checkIsOpenRouterContextWindowError(error) ||
		checkIsAnthropicContextWindowError(error) ||
		checkIsCerebrasContextWindowError(error) ||
		checkIsBedrockContextWindowError(error) ||
		checkIsVercelContextWindowError(error) ||
		checkIsZaiContextWindowError(error)
	)
}

/**
 * z.ai / GLM (`zai-coding-plan`) overflow.
 *
 * WHY THIS EXISTS. Recognising an overflow is what triggers the recovery path in Task —
 * `handleContextWindowExceededError()` truncates the conversation and retries. z.ai's overflow does not
 * look like anyone else's:
 *
 *   {"message":"400 Prompt exceeds max length","status":400,"code":"1261",
 *    "modelId":"glm-5-turbo","providerId":"zai-coding-plan","details":{"code":"1261",...}}
 *
 * `code` is "1261" rather than "400", and the message says "exceeds max length" — which matches none of
 * the "context length" / "maximum context" / "too many tokens" phrasings the other checks look for. So the
 * error was classified as a generic failure: the extension re-sent the SAME oversized prompt three times
 * with backoff and then gave up, never once compacting. A real session died exactly that way with 5 of
 * these errors and 0 compactions.
 *
 * This is the model-independent safety net: if a window size is ever configured wrongly for any model, the
 * recovery path still fires and the session survives.
 */
function checkIsZaiContextWindowError(error: any): boolean {
	try {
		const message = String(error?.message || error?.error?.message || error?.details?.message || "")
		const code = String(error?.code ?? error?.error?.code ?? error?.details?.code ?? "")

		// z.ai's documented code for this condition. Sufficient on its own.
		if (code === "1261") {
			return true
		}

		// Phrasing-based fallback, deliberately narrow: only "…exceeds max length" and "prompt too long",
		// both of which are unambiguously about input size. Broader wording risks truncating a
		// conversation over an unrelated 400.
		return /\b(?:prompt|input|request)\b[^.]{0,40}\bexceeds?\s+max(?:imum)?\s+length\b/i.test(message) ||
			/\bprompt\s+(?:is\s+)?too\s+long\b/i.test(message)
	} catch {
		return false
	}
}

function checkIsOpenRouterContextWindowError(error: any): boolean {
	try {
		const status = error?.status ?? error?.code ?? error?.error?.status ?? error?.response?.status
		const message: string = String(error?.message || error?.error?.message || "")

		// There seems to be an issue where the true status code is embedded only in the message itself
		const statusFromMessage = message.match(/"code":\s*(\d+)/)?.[1]
		const finalStatus = statusFromMessage || status

		// Known OpenAI/OpenRouter-style signal (code 400 and message includes "context length")
		const CONTEXT_ERROR_PATTERNS = [
			/\bcontext\s*(?:length|window)\b/i,
			/\bmaximum\s*context\b/i,
			/\b(?:input\s*)?tokens?\s*exceed/i,
			/\btoo\s*many\s*tokens?\b/i,
		] as const

		return String(finalStatus) === "400" && CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
	} catch {
		return false
	}
}

// Docs: https://platform.openai.com/docs/guides/error-codes/api-errors
function checkIsOpenAIContextWindowError(error: unknown): boolean {
	try {
		if (error instanceof LengthFinishReasonError) {
			return true
		}

		const KNOWN_CONTEXT_ERROR_SUBSTRINGS = ["token", "context length"] as const

		return (
			Boolean(error) &&
			error instanceof APIError &&
			error.code?.toString() === "400" &&
			KNOWN_CONTEXT_ERROR_SUBSTRINGS.some((substring) => error.message.includes(substring))
		)
	} catch {
		return false
	}
}

function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return response?.error?.error?.type === "invalid_request_error"
	} catch {
		return false
	}
}

function checkIsCerebrasContextWindowError(response: any): boolean {
	try {
		const status = response?.status ?? response?.code ?? response?.error?.status ?? response?.response?.status
		const message: string = String(response?.message || response?.error?.message || "")

		return String(status) === "400" && message.includes("Please reduce the length of the messages or completion")
	} catch {
		return false
	}
}

function checkIsBedrockContextWindowError(error: any): boolean {
	try {
		// Bedrock returns ValidationException for context window errors
		const errorType = error?.name ?? error?.error?.type ?? error?.__type
		const errorCode = error?.code ?? error?.error?.code ?? error?.$metadata?.httpStatusCode

		// Handle nested error structures (e.g., through Vercel AI SDK)
		const nestedError = error?.error?.param
		const nestedErrorCode = nestedError?.statusCode ?? error?.details?.code
		const nestedMessage = nestedError?.message ?? nestedError?.error

		const message: string = String(error?.message || error?.error?.message || nestedMessage || "")

		// Check for ValidationException with HTTP 400
		const isValidationException =
			errorType === "ValidationException" ||
			errorType === "AI_APICallError" ||
			String(errorCode) === "400" ||
			String(nestedErrorCode) === "400" ||
			error?.code === "stream_initialization_failed"

		if (!isValidationException) {
			return false
		}

		// Known Bedrock context window error patterns
		const BEDROCK_CONTEXT_PATTERNS = [
			/maximum tokens.*exceeds.*model limit/i,
			/input length and max_tokens exceed context limit/i,
			/context length.*exceeds/i,
			/total number of tokens.*exceeds.*limit/i,
			/requested.*tokens.*exceeds.*limit/i,
			/reduce.*length.*messages.*completion/i,
			/input is too long/i,
		] as const

		return BEDROCK_CONTEXT_PATTERNS.some((pattern) => pattern.test(message))
	} catch {
		return false
	}
}

export function checkIsVercelContextWindowError(error: any): boolean {
	try {
		const status = error?.status ?? error?.error?.param?.statusCode ?? error?.statusCode

		// Check for explicit context_length_exceeded code (OpenAI streaming errors)
		const errorCode = error?.error?.error?.code
		if (errorCode === "context_length_exceeded") {
			return true
		}

		const messages: string[] = [
			error?.message,
			error?.error?.message,
			error?.error?.param?.message,
			error?.error?.param?.error,
			error?.error?.error?.message,
			error?.error?.value?.error_message, // Alibaba Qwen validation errors
		].filter((msg) => msg != null)

		if (messages.length === 0) {
			return false
		}

		// Must be a 400 error OR have 400 embedded in error_message (Alibaba Qwen case)
		const hasValidStatus = String(status) === "400"
		const errorMessage = error?.error?.value?.error_message
		const has400InMessage =
			errorMessage &&
			typeof errorMessage === "string" &&
			(errorMessage.includes('"code":400') || errorMessage.includes('"code": 400'))

		if (!hasValidStatus && !has400InMessage) {
			return false
		}

		const CONTEXT_ERROR_PATTERNS = [
			/input is too long/i,
			/input token count exceeds.*maximum.*tokens? allowed/i,
			/input exceeds.*context window/i,
			/requested input length.*exceeds.*maximum input length/i,
			/prompt is too long.*tokens?\s*>\s*\d+\s*maximum/i,
			/\bcontext\s*(?:length|window)\b.*exceed/i,
			/\bmaximum\s*context\b/i,
			/\b(?:input\s*)?tokens?\s*exceed/i,
			/too\s*many\s*tokens/i,
		] as const

		return messages
			.map((msg) => String(msg).toLowerCase())
			.some((message) => CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(message)))
	} catch {
		return false
	}
}
