import { DeepSeekModelId, deepSeekDefaultModelId, deepSeekModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
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
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
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

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const isDeepseekReasoner = model.id.includes("deepseek-reasoner")
		// DeepSeek V4 (deepseek-v4-flash/pro) toggles thinking via thinking.type (enabled/disabled), like GLM — not a
		// separate model id. Send it only when the user set an explicit on/off (thinkingBudgetTokens); the OpenAI SDK
		// forwards the unknown body field to DeepSeek. The old deepseek-reasoner keeps its R1 message format.
		const isV4 = model.id.startsWith("deepseek-v4")
		const budget = this.options.thinkingBudgetTokens
		const v4Thinking: Record<string, unknown> =
			isV4 && budget !== undefined ? { thinking: { type: budget > 0 ? "enabled" : "disabled" } } : {}
		const v4ThinkingOn = isV4 && (budget ?? 0) > 0
		// reasoning_effort tunes HOW DEEPLY it thinks: "low" | "high" | "max" (api-docs.deepseek.com,
		// guides/thinking_mode, checked 2026-08-16). Both v4-flash and v4-pro support all three. It only has
		// meaning with thinking on, and DeepSeek's own default is enabled at "high" — so send it only when the
		// developer has chosen, and never alongside thinking disabled.
		const v4Effort: Record<string, unknown> =
			v4ThinkingOn && this.options.reasoningEffort ? { reasoning_effort: this.options.reasoningEffort } : {}

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const stream = await client.chat.completions.create({
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
		})

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

	getModel(): { id: DeepSeekModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in deepSeekModels) {
			const id = modelId as DeepSeekModelId
			return { id, info: deepSeekModels[id] }
		}
		return {
			id: deepSeekDefaultModelId,
			info: deepSeekModels[deepSeekDefaultModelId],
		}
	}
}
