import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { ToolExecutor } from "../ToolExecutor"

/**
 * Host issue H2, 14 September: after the provider changed under a running task, every tool-use record
 * still named the first model (`modelId: free-default` on turns the configured route served). The tool
 * layer held the handler it was built with; the task had replaced it.
 */
describe("tools see the task's current model, not the one it started on", () => {
	const handler = (id: string) => ({ getModel: () => ({ id, info: {} }), createMessage: () => undefined }) as never

	it("the tool config follows a handler swapped under the running task", () => {
		let current = handler("free-default")
		const ex = Object.create(ToolExecutor.prototype) as Record<string, unknown>
		ex.apiSource = () => current
		ex.stateManager = { getGlobalSettingsKey: () => undefined }
		// `api` is what the tool config and every tool-use record read (asToolConfig: `api: this.api`).
		const configOf = () => ({ api: (ex as unknown as { api: { getModel(): { id: string } } }).api })

		assert.equal(configOf().api.getModel().id, "free-default")
		current = handler("deepseek/deepseek-v4-flash-0731") // what updateApiConfigurationProto does to task.api
		assert.equal(configOf().api.getModel().id, "deepseek/deepseek-v4-flash-0731")
	})

	it("a fixed handler still works for callers that pass one", () => {
		const ex = Object.create(ToolExecutor.prototype) as Record<string, unknown>
		ex.apiSource = handler("fixed")
		ex.stateManager = { getGlobalSettingsKey: () => undefined }
		assert.equal((ex as unknown as { api: { getModel(): { id: string } } }).api.getModel().id, "fixed")
	})
})
