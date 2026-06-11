import type { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineEnv } from "@/config"
import { markQuotaExhausted, persistCachedFreeTokensRemaining, shouldFireFirstRunStarted } from "@/services/adsum/FreeTierState"
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
				// Intercept 402/429 in the fetch layer.
				// For 402: set a module-level flag (immune to SDK wrapping / instanceof
				// issues across bundle boundaries) and throw so the SDK stops processing.
				// The flag is consumed in the task's empty-response path, which renders
				// the QuotaExhaustedCard cleanly with no retries.
				fetch: async (...args: Parameters<typeof fetch>) => {
					const resp = await fetch(...args)

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
						// Quota is gone — zero the displayed remaining NOW. The success path only updates
						// the chip from the (pre-request) X-Free-Quota-Remaining header, so without this the
						// chip stays stuck at the last header value (~one request's worth) — the
						// "still shows ~20k tokens when exhausted" bug.
						this.remainingQuota = 0
						persistCachedFreeTokensRemaining(0)
						markQuotaExhausted()
						telemetryService.captureFreeTierQuotaExhausted(getInstallId(), 0)
						throw new QuotaExhaustedError(payload)
					}

					if (resp.status === 429) {
						throw new Error(
							"adsum:rate_limited — Too many requests. Please wait a moment before sending another message.",
						)
					}

					const remaining = resp.headers.get("x-free-quota-remaining")
					if (remaining !== null) {
						const n = Number(remaining)
						this.remainingQuota = n
						persistCachedFreeTokensRemaining(n)
					}
					return resp
				},
			})
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		// Funnel-entry event — fire exactly once per install, not on every agent
		// step or session restart (which previously inflated it ~26x per install).
		if (await shouldFireFirstRunStarted()) {
			telemetryService.captureFreeTierFirstRunStarted(getInstallId())
		}
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
			// The SDK wraps errors thrown from our fetch in APIConnectionError.
			// Check err and err.cause for our known markers as a fast path.
			const msgSources = [err?.message, err?.cause?.message]
			if (msgSources.some((m) => typeof m === "string" && m === "adsum:quota_exhausted")) {
				throw new QuotaExhaustedError({ reason: "quota_exhausted", remaining: 0, next: ["verify_email", "add_byok"] })
			}
			if (err?.status === 429 || msgSources.some((m) => typeof m === "string" && m.startsWith("adsum:rate_limited"))) {
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
				// Decrement the displayed remaining by THIS request's actual usage. The backend's
				// X-Free-Quota-Remaining header is the PRE-request balance, so without this the chip
				// lags a full request behind and never reaches 0 on the request that exhausts quota.
				// Matches the backend's deduction (prompt + completion, including cached); the next
				// request's header re-syncs it authoritatively, so this can't drift.
				const usedTokens = (chunk.usage.prompt_tokens || 0) + (chunk.usage.completion_tokens || 0)
				if (this.remainingQuota !== undefined && usedTokens > 0) {
					this.remainingQuota = Math.max(0, this.remainingQuota - usedTokens)
					persistCachedFreeTokensRemaining(this.remainingQuota)
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return { id: ADSUM_FREE_MODEL_ID, info: ADSUM_FREE_MODEL_INFO }
	}
}
