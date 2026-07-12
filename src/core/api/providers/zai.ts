import {
	GLM_EFFORT_MODELS,
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
	// GLM-5.2 reasoning_effort (High|Max). Only sent when thinking is on AND the model supports it (glm-5.2).
	reasoningEffort?: string
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
		// Only use modelId when it's actually in the active catalog — otherwise fall back to the default. Guards against
		// an empty string or a stale id left over from a previously-selected provider (e.g. a Claude model id) reaching
		// z.ai, which rejects those with 400 "model code cannot be empty" (1214) / "Unknown Model" (1211).
		if (this.isCodingPlan()) {
			const id: zaiCodingPlanModelId =
				modelId && modelId in zaiCodingPlanModels ? (modelId as zaiCodingPlanModelId) : zaiCodingPlanDefaultModelId
			return { id, info: zaiCodingPlanModels[id] }
		}
		if (this.useChinaApi()) {
			const id: mainlandZAiModelId =
				modelId && modelId in mainlandZAiModels ? (modelId as mainlandZAiModelId) : mainlandZAiDefaultModelId
			return { id, info: mainlandZAiModels[id] }
		}
		const id: internationalZAiModelId =
			modelId && modelId in internationalZAiModels ? (modelId as internationalZAiModelId) : internationalZAiDefaultModelId
		return { id, info: internationalZAiModels[id] }
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
			// reasoning_effort tunes depth but only takes effect with thinking on (z.ai docs). Gated on the model's
			// supportsReasoningEffort so it's never sent to glm-5-turbo/4.7, which don't support it.
			...(thinkingBudget !== undefined &&
			thinkingBudget > 0 &&
			GLM_EFFORT_MODELS.has(model.id) &&
			this.options.reasoningEffort
				? { reasoning_effort: this.options.reasoningEffort }
				: {}),
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
