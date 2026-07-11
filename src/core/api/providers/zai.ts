import {
	internationalZAiDefaultModelId,
	internationalZAiModelId,
	internationalZAiModels,
	ModelInfo,
	mainlandZAiDefaultModelId,
	mainlandZAiModelId,
	mainlandZAiModels,
	zaiCodingPlanDefaultModelId,
	zaiCodingPlanModelId,
	zaiCodingPlanModels,
} from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { version as extensionVersion } from "../../../../package.json"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface ZAiHandlerOptions extends CommonApiHandlerOptions {
	zaiApiLine?: string
	zaiApiKey?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

export class ZAiHandler implements ApiHandler {
	private options: ZAiHandlerOptions
	private client: OpenAI | undefined
	constructor(options: ZAiHandlerOptions) {
		this.options = options
	}

	// GLM Coding Plan = the flat z.ai subscription. It authenticates ONLY through the OpenAI-compatible *coding*
	// endpoint; a coding-plan key on the general /paas/v4 returns z.ai error 1113. (China coding URL is
	// community-sourced — verify before relying on it.)
	private isCodingPlan(): boolean {
		return this.options.zaiApiLine === "coding" || this.options.zaiApiLine === "coding-china"
	}

	private useChinaApi(): boolean {
		return this.options.zaiApiLine === "china" || this.options.zaiApiLine === "coding-china"
	}

	private baseUrl(): string {
		if (this.isCodingPlan()) {
			return this.useChinaApi() ? "https://open.bigmodel.cn/api/coding/paas/v4" : "https://api.z.ai/api/coding/paas/v4"
		}
		return this.useChinaApi() ? "https://open.bigmodel.cn/api/paas/v4" : "https://api.z.ai/api/paas/v4"
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.zaiApiKey) {
				throw new Error("Z AI API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: this.baseUrl(),
					apiKey: this.options.zaiApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline",
						"X-Cline-Version": extensionVersion,
					},
					fetch, // Use configured fetch with proxy support
				})
			} catch (error: any) {
				throw new Error(`Error creating Z AI client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: mainlandZAiModelId | internationalZAiModelId | zaiCodingPlanModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (this.isCodingPlan()) {
			return {
				id: (modelId as zaiCodingPlanModelId) ?? zaiCodingPlanDefaultModelId,
				info: zaiCodingPlanModels[modelId as zaiCodingPlanModelId] ?? zaiCodingPlanModels[zaiCodingPlanDefaultModelId],
			}
		}
		if (this.useChinaApi()) {
			return {
				id: (modelId as mainlandZAiModelId) ?? mainlandZAiDefaultModelId,
				info: mainlandZAiModels[modelId as mainlandZAiModelId] ?? mainlandZAiModels[mainlandZAiDefaultModelId],
			}
		} else {
			return {
				id: (modelId as internationalZAiModelId) ?? internationalZAiDefaultModelId,
				info:
					internationalZAiModels[modelId as internationalZAiModelId] ??
					internationalZAiModels[internationalZAiDefaultModelId],
			}
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		// GLM native thinking (thinking.type): send enabled/disabled only when the user set an explicit on/off toggle;
		// omit entirely otherwise so the model applies its own default. (z.ai devpack docs.)
		const thinkingBudget = this.options.thinkingBudgetTokens
		const stream = await client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
			...(thinkingBudget !== undefined ? { thinking: { type: thinkingBudget > 0 ? "enabled" : "disabled" } } : {}),
		} as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

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

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					cacheWriteTokens: 0,
				}
			}
		}
	}
}
