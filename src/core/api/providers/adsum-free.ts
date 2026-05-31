import type { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineEnv } from "@/config"
import { getInstallId } from "@/services/adsum/InstallIdentity"
import { Logger } from "@/services/logging/Logger"
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
	contextWindow: 64_000,
	supportsImages: false,
	supportsPromptCache: true,
	cacheReadsPrice: 0,
	cacheWritesPrice: 0,
	inputPrice: 0,
	outputPrice: 0,
	description: "Free tier powered by Adsum — no API key required.",
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
		super("Free tier quota exhausted.")
		this.name = "QuotaExhaustedError"
		this.reason = payload.reason
		this.remaining = payload.remaining
		this.next = payload.next
	}
}

interface AdsumFreeHandlerOptions extends CommonApiHandlerOptions {
	ulid?: string
}

export class AdsumFreeHandler implements ApiHandler {
	private options: AdsumFreeHandlerOptions
	private client: OpenAI | undefined
	private readonly _baseUrl = ClineEnv.config().adsumApiBaseUrl

	/** Remaining free-tier tokens — updated from X-Free-Quota-Remaining header */
	remainingQuota: number | undefined

	constructor(options: AdsumFreeHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			this.client = new OpenAI({
				baseURL: `${this._baseUrl}/v1`,
				apiKey: getInstallId(), // install_id is the credential for the free tier
				defaultHeaders: {
					"X-Install-ID": getInstallId(),
					"X-Task-ID": this.options.ulid || "",
				},
				// Pass the raw fetch so we can read response headers for quota
				fetch: async (...args: Parameters<typeof fetch>) => {
					const resp = await fetch(...args)

					// Intercept 402 before the OpenAI SDK tries to parse the body
					if (resp.status === 402) {
						let payload: { reason: string; remaining: number; next: string[] } = {
							reason: "quota_exhausted",
							remaining: 0,
							next: ["verify_email", "add_byok"],
						}
						try {
							payload = await resp.clone().json()
						} catch {
							// use default payload
						}
						throw new QuotaExhaustedError(payload)
					}

					// Update remaining quota from every response header
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
		const client = this.ensureClient()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: ADSUM_FREE_MODEL_ID,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		})

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
