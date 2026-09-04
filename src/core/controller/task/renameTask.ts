import { Empty } from "@shared/proto/cline/common"
import { RenameTaskRequest } from "@shared/proto/cline/task"
import { Controller } from "../"

/**
 * Name a session. Same shape as toggleTaskFavorite: one field on the history row, state re-posted.
 *
 * The first prompt is never overwritten — it is the record of what the model was asked, and the
 * drawer's filter still searches it — so a rename adds `title` beside `task` rather than replacing
 * it. An empty title clears the name.
 */
export async function renameTask(controller: Controller, request: RenameTaskRequest): Promise<Empty> {
	if (!request.taskId) {
		console.error("[renameTask] Invalid request: taskId missing")
		return Empty.create({})
	}
	const title = (request.title ?? "").trim()
	try {
		const history = controller.stateManager.getGlobalStateKey("taskHistory")
		const idx = history.findIndex((item) => item.id === request.taskId)
		if (idx === -1) {
			console.log("[renameTask] Task not found in history array")
		} else {
			const updated = [...history]
			const { title: _old, ...rest } = updated[idx]
			updated[idx] = title ? { ...rest, title } : rest
			controller.stateManager.setGlobalState("taskHistory", updated)
		}
		await controller.postStateToWebview()
	} catch (error) {
		console.error("Error in renameTask:", error)
	}
	return Empty.create({})
}
