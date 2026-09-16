import { DeepSeekModelId, deepSeekDefaultModelId, deepSeekModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { isServedLiveModel } from "@/core/api/models/liveModelLists"
import { applyPriceOverlay } from "@/core/api/pricing/priceOverlay"
import { UNKNOWN_MODEL_INFO } from "@/shared/liveModels"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface DeepSeekHandlerOptions extends CommonApiHandlerOptions {
	deepSeekApiKey?: string
	apiModelId?: string
	// DeepSeek V4 toggles thinking via thinking.type; we reuse thinkingBudgetTokens as the on/off signal (>0 = on).
	thinkingBudgetTokens?: number
	// Depth once thinking is on: "low" | "high" | "max". Meaningless with thinking off, so it is only sent
	// alongside thinking: enabled.
	reasoningEffort?: string
}

export class DeepSeekHandler implements ApiHandler {
	private options: DeepSeekHandlerOptions
	private client: OpenAI | undefined

	constructor(options: DeepSeekHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.deepSeekApiKey) {
				throw new Error("DeepSeek API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.deepseek.com/v1",
					apiKey: this.options.deepSeekApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating DeepSeek client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		// Deepseek reports total input AND cache reads/writes,
		// see context caching: https://api-docs.deepseek.com/guides/kv_cache)
		// where the input tokens is the sum of the cache hits/misses, just like OpenAI.
		// This affects:
		// 1) context management truncation algorithm, and
		// 2) cost calculation

		// Deepseek usage includes extra fields.
		// Safely cast the prompt token details section to the appropriate structure.
		interface DeepSeekUsage extends OpenAI.CompletionUsage {
			prompt_cache_hit_tokens?: number
			prompt_cache_miss_tokens?: number
		}
		const deepUsage = usage as DeepSeekUsage

		const inputTokens = deepUsage?.prompt_tokens || 0 // sum of cache hits and misses
		const outputTokens = deepUsage?.completion_tokens || 0
		const cacheReadTokens = deepUsage?.prompt_cache_hit_tokens || 0
		const cacheWriteTokens = deepUsage?.prompt_cache_miss_tokens || 0
		// The model id carries DeepSeek's peak/off-peak schedule — half rate outside 01:00–04:00 and
		// 06:00–10:00 UTC on weekdays, which is most of the week. Without it every cost shown here is
		// the peak figure regardless of when the request actually ran.
		const totalCost = calculateApiCostOpenAI(
			info,
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			undefined,
			this.getModel().id,
		)
		const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens) // this will always be 0
		yield {
			type: "usage",
			inputTokens: nonCachedInputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	/** One per request, so the stall watchdog's abort() cancels the HTTP request rather than abandoning it. */
	private abortController?: AbortController

	abort(): void {
		this.abortController?.abort()
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		this.abortController?.abort()
		const controller = new AbortController()
		this.abortController = controller
		const client = this.ensureClient()
		const model = this.getModel()

		const isDeepseekReasoner = model.id.includes("deepseek-reasoner")
		// DeepSeek V4-class models toggle thinking via thinking.type (enabled/disabled), like GLM — not a
		// separate model id. Send it only when the user set an explicit on/off (thinkingBudgetTokens); the OpenAI SDK
		// forwards the unknown body field to DeepSeek. The old deepseek-reasoner keeps its R1 message format.
		//
		// WHICH MODELS TAKE IT IS DECLARED, NOT READ OFF THE NAME. This was `startsWith("deepseek-v4")`, and
		// the vendor's current Flash is `deepseek-flash` (V4.1-Flash) — no "deepseek-v4" in the id, so both the
		// toggle and the effort level silently went nowhere for the model most people are on. `supportsReasoning`
		// is what the settings panel gates the same controls on (getThinkingControl), so panel and wire now agree
		// by construction rather than by two lists being kept in step.
		const takesThinkingParams = model.info.supportsReasoning === true
		const budget = this.options.thinkingBudgetTokens
		// Choosing a depth IS choosing to think. [OPERATOR 2026-09-04] "deepseek is configured with
		// thinking = low but I see very long thinking sessions" — and it was: the panel shows the
		// effort dropdown whenever the budget is undefined (its `thinkingEnabled` treats undefined as
		// on), so a developer could pick Low, have `reasoningEffort` stored, and still hit BOTH of
		// the guards below, which only fire on an explicit budget. Neither parameter went on the
		// wire and DeepSeek's own server default — enabled at "high" — won every request. The
		// settings panel now mirrors this rule exactly, and an effort with no budget is honoured
		// rather than silently dropped, so a configuration made before this fix starts working
		// without being re-toggled.
		const effort = this.options.reasoningEffort
		const wantsThinking = (budget ?? 0) > 0 || (budget === undefined && Boolean(effort))
		const v4Thinking: Record<string, unknown> =
			takesThinkingParams && (budget !== undefined || effort)
				? { thinking: { type: wantsThinking ? "enabled" : "disabled" } }
				: {}
		const v4ThinkingOn = takesThinkingParams && wantsThinking
		// reasoning_effort tunes HOW DEEPLY it thinks: "low" | "high" | "max" (api-docs.deepseek.com,
		// guides/thinking_mode, checked 2026-08-16). Both v4-flash and v4-pro support all three. It only has
		// meaning with thinking on, and DeepSeek's own default is enabled at "high" — so send it only when the
		// developer has chosen, and never alongside thinking disabled.
		const v4Effort: Record<string, unknown> = v4ThinkingOn && effort ? { reasoning_effort: effort } : {}

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const stream = await client.chat.completions.create(
			{
				model: model.id,
				max_completion_tokens: model.info.maxTokens,
				messages: openAiMessages,
				stream: true,
				stream_options: { include_usage: true },
				// Thinking mode ignores temperature/top_p/penalties (documented as accepted-but-inert), and R1
				// rejects a custom temperature outright — so omit it in both cases and use 0 everywhere else.
				...(model.id === "deepseek-reasoner" || v4ThinkingOn ? {} : { temperature: 0 }),
				...v4Thinking,
				...v4Effort,
				...getOpenAIToolParams(tools),
			},
			{ signal: controller.signal },
		)

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in deepSeekModels) {
			const id = modelId as DeepSeekModelId
			return { id, info: applyPriceOverlay(id, deepSeekModels[id]) }
		}
		// Served by DeepSeek but newer than the shipped table (e.g. a renamed model): send it as chosen, with
		// conservative info and no prices, rather than quietly swapping in the default.
		if (modelId && isServedLiveModel("deepseek", modelId)) {
			return { id: modelId, info: applyPriceOverlay(modelId, { ...UNKNOWN_MODEL_INFO }) }
		}
		return {
			id: deepSeekDefaultModelId,
			info: applyPriceOverlay(deepSeekDefaultModelId, deepSeekModels[deepSeekDefaultModelId]),
		}
	}
}
