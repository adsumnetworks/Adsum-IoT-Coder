import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity"
import { azureOpenAiDefaultApiVersion, ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI, { AzureOpenAI } from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { effectiveMaxOutputTokens } from "@core/context/context-management/output-reservation"
import { splitOpenAiUsage } from "../transform/openai-usage"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface OpenAiHandlerOptions extends CommonApiHandlerOptions {
	openAiApiKey?: string
	openAiBaseUrl?: string
	azureApiVersion?: string
	azureIdentity?: boolean
	openAiHeaders?: Record<string, string>
	openAiModelId?: string
	openAiModelInfo?: OpenAiCompatibleModelInfo
	reasoningEffort?: string
}

export class OpenAiHandler implements ApiHandler {
	private options: OpenAiHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiHandlerOptions) {
		this.options = options
	}

	private getAzureAudienceScope(baseUrl?: string): string {
		const url = baseUrl?.toLowerCase() ?? ""
		if (url.includes("azure.us")) return "https://cognitiveservices.azure.us/.default"
		if (url.includes("azure.com")) return "https://cognitiveservices.azure.com/.default"
		return "https://cognitiveservices.azure.com/.default"
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiApiKey && !this.options.azureIdentity) {
				throw new Error("OpenAI API key or Azure Identity Authentication is required")
			}
			try {
				const baseUrl = this.options.openAiBaseUrl?.toLowerCase() ?? ""
				const isAzureDomain = baseUrl.includes("azure.com") || baseUrl.includes("azure.us")
				// Azure API shape slightly differs from the core API shape...
				if (
					this.options.azureApiVersion ||
					(isAzureDomain && !this.options.openAiModelId?.toLowerCase().includes("deepseek"))
				) {
					if (this.options.azureIdentity) {
						this.client = new AzureOpenAI({
							baseURL: this.options.openAiBaseUrl,
							azureADTokenProvider: getBearerTokenProvider(
								new DefaultAzureCredential(),
								this.getAzureAudienceScope(this.options.openAiBaseUrl),
							),
							apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: this.options.openAiHeaders,
							fetch,
						})
					} else {
						this.client = new AzureOpenAI({
							baseURL: this.options.openAiBaseUrl,
							apiKey: this.options.openAiApiKey,
							apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: this.options.openAiHeaders,
							fetch,
						})
					}
				} else {
					this.client = new OpenAI({
						baseURL: this.options.openAiBaseUrl,
						apiKey: this.options.openAiApiKey,
						defaultHeaders: this.options.openAiHeaders,
						fetch,
					})
				}
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.openAiModelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isR1FormatRequired = this.options.openAiModelInfo?.isR1FormatRequired ?? false
		const isReasoningModelFamily =
			["o1", "o3", "o4", "gpt-5"].some((prefix) => modelId.includes(prefix)) && !modelId.includes("chat")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		let temperature: number | undefined
		if (this.options.openAiModelInfo?.temperature !== undefined) {
			const tempValue = Number(this.options.openAiModelInfo.temperature)
			temperature = tempValue === 0 ? undefined : tempValue
		} else {
			temperature = openAiModelInfoSaneDefaults.temperature
		}
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		let maxTokens: number | undefined

		if (this.options.openAiModelInfo?.maxTokens && this.options.openAiModelInfo.maxTokens > 0) {
			// Capped: prompt + requested output both count against the window, and some
			// openai-compatible models declare an output limit that consumes most of it.
			maxTokens = effectiveMaxOutputTokens(this.options.openAiModelInfo)
		} else {
			maxTokens = undefined
		}

		if (isDeepseekReasoner || isR1FormatRequired) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		if (isReasoningModelFamily) {
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			temperature = undefined // does not support temperature
			reasoningEffort = (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium"
		}

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			reasoning_effort: reasoningEffort,
			stream: true,
			stream_options: { include_usage: true },
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
				// prompt_tokens already includes cached_tokens (and DeepSeek-style
				// hit/miss fields sum to it) — split into disjoint buckets or the
				// context gauge double-counts every cached token (~×1.9 measured).
				yield splitOpenAiUsage(chunk.usage)
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
