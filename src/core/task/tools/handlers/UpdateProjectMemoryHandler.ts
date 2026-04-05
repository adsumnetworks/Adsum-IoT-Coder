import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class UpdateProjectMemoryHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.UPDATE_MEMORY

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.filename}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const filename = block.params.filename
		if (!filename) return

		const partialMessage = JSON.stringify({
			tool: "update_project_memory",
			path: filename,
			content: block.params.content || "",
		})

		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, filename)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const filename = block.params.filename as string
		const content = block.params.content as string

		if (!filename) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "filename")
		}

		if (!content) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Identify memory path securely using the hashing model
		const hash = crypto.createHash("md5").update(config.cwd).digest("hex")
		const globalStorage = HostProvider.get().globalStorageFsPath
		const memoryDir = path.join(globalStorage, "iot-memory", hash)

		// Only allow valid memory filenames
		const validFiles = ["project.md", "devices.md", "session.md"]
		if (!validFiles.includes(filename)) {
			return formatResponse.toolError(
				`Invalid filename '${filename}'. Allowed values are: project.md, devices.md, session.md`,
			)
		}

		const fullPath = path.join(memoryDir, filename)

		// Ask approval
		const completeMessage = JSON.stringify({
			tool: "update_project_memory",
			path: filename,
			content: content,
		})

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, filename)) {
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
		} else {
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
			const { response } = await config.callbacks.ask("tool", completeMessage, false)
			if (response !== "yesButtonClicked") {
				config.taskState.didRejectTool = true
				return "The user denied this operation. Memory was not updated."
			}
		}

		try {
			await fs.mkdir(memoryDir, { recursive: true })
			await fs.writeFile(fullPath, content, "utf-8")
		} catch (error) {
			return formatResponse.toolError(`Failed to save memory file: ${error}`)
		}

		return `Successfully updated memory file: ${filename}\n\nContents have been securely saved to the persistent tracker.`
	}
}
