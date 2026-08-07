import type { ToolUse } from "@core/assistant-message"
import { applyMemoryWrite } from "@core/memory/workspace/writeApply"
import { type MemoryTarget, validateMemoryWrite } from "@core/memory/workspace/writeRules"
import { formatResponse } from "@core/prompts/responses"
import path from "path"
import { ADSUM_DIR } from "@/core/memory/workspace/paths"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * `update_project_memory` — the model's ONLY write access to project memory.
 *
 * This handler is deliberately thin. Everything that decides anything lives in
 * `@core/memory/workspace/writeRules` (pure, exhaustively tested — `npm run test:memory-write`) and
 * `writeApply` (routing + store.ts). What is left here is parameter plumbing, the approval prompt,
 * and turning a decision into a tool result.
 *
 * It replaced a handler that took `filename` + `content` and did `writeFile(path, content)`. Three
 * things were wrong with that, all of them visible in real sessions:
 *
 *   - It could clobber HOST-owned records (detected apps, hardware, toolchain, the workspace map)
 *     with the model's guesses, and nothing could tell the two apart afterwards.
 *   - Being a whole-file write, "update the goal" meant "rewrite the file", and after hours inside
 *     one bug the project's goal came back as the bug.
 *   - It accepted anything, so capture output ended up in memory and then rode in the context of
 *     every future turn for that workspace.
 *
 * The tool now writes one named thing at a time, and every refusal explains what to do instead —
 * a rejection that only says "no" costs a turn and gets retried verbatim.
 */
export class UpdateProjectMemoryHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.UPDATE_MEMORY

	getDescription(block: ToolUse): string {
		const { target, op, id } = block.params
		return `[${block.name} ${op ?? "?"} ${target ?? "?"}${id ? ` '${id}'` : ""}]`
	}

	/**
	 * Where this write will land, as a workspace-relative path. Used for the approval prompt and
	 * for the auto-approve path check, both of which want a real path rather than a label.
	 */
	private displayPath(target: string | undefined, id: string | undefined): string {
		switch (target as MemoryTarget) {
			case "goal":
			case "defect":
				return path.join(ADSUM_DIR, "status.json")
			case "note":
				return path.join(ADSUM_DIR, "notes", `${id || "note"}.md`)
			case "hw-asserted":
				return path.join(ADSUM_DIR, "PROJECT.md")
			default:
				return ADSUM_DIR
		}
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const target = block.params.target
		if (!target) {
			return
		}
		const relPath = this.displayPath(target, block.params.id)
		const partialMessage = JSON.stringify({
			tool: "update_project_memory",
			path: relPath,
			content: block.params.content || "",
		})

		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const decision = validateMemoryWrite({
			target: block.params.target,
			op: block.params.op,
			id: block.params.id,
			content: block.params.content,
		})

		// Validation runs BEFORE the approval prompt on purpose: a write that will be refused must
		// never reach the user as a question, and the model must get the correction in the same turn.
		if (!decision.ok) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(decision.reason)
		}
		config.taskState.consecutiveMistakeCount = 0

		const relPath = this.displayPath(decision.target, decision.id)
		const completeMessage = JSON.stringify({
			tool: "update_project_memory",
			path: `${decision.op} ${decision.target}${decision.id ? ` '${decision.id}'` : ""} → ${relPath}`,
			content: decision.content,
		})

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)) {
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

		// Fail-open: memory is an enhancement and must never be able to kill a task, so even an
		// unexpected throw comes back as a tool error the model can act on.
		try {
			const result = applyMemoryWrite(config.cwd, decision, new Date().toISOString())
			return result.ok ? result.message : formatResponse.toolError(result.message)
		} catch (error) {
			return formatResponse.toolError(`Failed to save project memory: ${error instanceof Error ? error.message : error}`)
		}
	}
}
