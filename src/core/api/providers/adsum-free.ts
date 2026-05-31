import type { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineEnv } from "@/config"
import { getInstallId } from "@/services/adsum/InstallIdentity"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

export const ADSUM_FREE_MODEL_ID = "free-default"

export const ADSUM_FREE_MODEL_INFO: ModelInfo = {
	name: "Adsum Free Tier",
	maxTokens: 8192,
	contextWindow: 128_000,
	supportsImages: false,
	supportsPromptCache: true,
	cacheReadsPrice: 0,
	cacheWritesPrice: 0,
	inputPrice: 0,
	outputPrice: 0,
	description: "Free tier — inference is provided by Adsum Networks. No API key required.",
}

/**
 * Thrown when the backend returns HTTP 402 (quota exhausted).
 * The client renders a conversion card (verify email / add BYOK).
 */
export class QuotaExhaustedError extends Error {
	readonly reason: string
	readonly remaining: number
	readonly next: string[]

	constructor(payload: { reason: string; remaining: number; next: string[] }) {
		// Embed the marker so the webview detects it and renders the conversion card
		super("adsum:quota_exhausted")
		this.name = "QuotaExhaustedError"
		this.reason = payload.reason
		this.remaining = payload.remaining
		this.next = payload.next
	}
}

interface AdsumFreeHandlerOptions extends CommonApiHandlerOptions {
	ulid?: string
	initialRemainingQuota?: number
}

export class AdsumFreeHandler implements ApiHandler {
	private options: AdsumFreeHandlerOptions
	private client: OpenAI | undefined
	private readonly _baseUrl = ClineEnv.config().adsumApiBaseUrl

	/** Remaining free-tier tokens — updated from X-Free-Quota-Remaining header */
	remainingQuota: number | undefined

	constructor(options: AdsumFreeHandlerOptions) {
		this.options = options
		// Seed from registration response so the chip is populated before the first call
		this.remainingQuota = options.initialRemainingQuota
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			this.client = new OpenAI({
				baseURL: `${this._baseUrl}/v1`,
				apiKey: getInstallId(), // install_id is the credential for the free tier
				maxRetries: 0, // our @withRetry decorator owns retry logic for this handler
				defaultHeaders: {
					"X-Install-ID": getInstallId(),
					"X-Task-ID": this.options.ulid || "",
				},
				// Only read the quota header here — never throw from fetch.
				// Throwing from fetch makes the SDK treat any HTTP error as a
				// network failure and apply connection-error semantics (retry + wrap).
				// Status codes (402, 429) are handled in createMessage via APIError.
				fetch: async (...args: Parameters<typeof fetch>) => {
					const resp = await fetch(...args)
					const remaining = resp.headers.get("x-free-quota-remaining")
					if (remaining !== null) {
						this.remainingQuota = Number(remaining)
					}
					return resp
				},
			})
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		telemetryService.captureFreeTierFirstRunStarted(getInstallId())
		const client = this.ensureClient()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
		try {
			stream = await client.chat.completions.create({
				model: ADSUM_FREE_MODEL_ID,
				messages: openAiMessages,
				stream: true,
				stream_options: { include_usage: true },
				...getOpenAIToolParams(tools),
			})
		} catch (err: any) {
			// The SDK exposes HTTP errors as APIError with a .status field.
			// Handle them here so they never surface as raw "Connection error".
			if (err?.status === 402) {
				let payload: { reason: string; remaining: number; next: string[] } = {
					reason: "quota_exhausted",
					remaining: 0,
					next: ["verify_email", "add_byok"],
				}
				try {
					// APIError body is available on err.error
					if (err.error) {
						payload = { ...payload, ...err.error }
					}
				} catch {
					// use default payload
				}
				telemetryService.captureFreeTierQuotaExhausted(getInstallId(), 0)
				throw new QuotaExhaustedError(payload)
			}
			if (err?.status === 429) {
				throw new Error("adsum:rate_limited — Too many requests. Please wait a moment before sending another message.")
			}
			throw err
		}

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			Logger.debug("AdsumFreeHandler chunk: " + JSON.stringify(chunk))

			const delta = chunk.choices?.[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			// DeepSeek returns reasoning content in this field
			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				const cached = chunk.usage.prompt_tokens_details?.cached_tokens || 0
				yield {
					type: "usage",
					inputTokens: (chunk.usage.prompt_tokens || 0) - cached,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: cached,
					cacheWriteTokens: 0,
					totalCost: 0, // free tier, no cost to the user
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return { id: ADSUM_FREE_MODEL_ID, info: ADSUM_FREE_MODEL_INFO }
	}
}
