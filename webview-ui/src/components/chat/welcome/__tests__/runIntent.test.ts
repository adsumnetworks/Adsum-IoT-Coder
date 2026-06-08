import { beforeEach, describe, expect, it, vi } from "vitest"
import { runIntent } from "../runIntent"
import { buildIntentPrompt } from "../welcomeIntents"

// Mock the gRPC client so openProject routing can be asserted without a real backend.
const openFolder = vi.fn()
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFolder: (...args: unknown[]) => openFolder(...args),
	},
}))

describe("runIntent — shared intent routing", () => {
	let onSelectMode: ReturnType<typeof vi.fn>
	let onStartTask: ReturnType<typeof vi.fn>

	beforeEach(() => {
		onSelectMode = vi.fn()
		onStartTask = vi.fn()
		openFolder.mockClear()
	})

	it("debug → enters log_analyzer mode, never starts a free-text task", () => {
		runIntent("debug", { onSelectMode, onStartTask })
		expect(onSelectMode).toHaveBeenCalledWith("log_analyzer")
		expect(onStartTask).not.toHaveBeenCalled()
		expect(openFolder).not.toHaveBeenCalled()
	})

	it("openProject → opens the folder picker, never starts a task or selects a mode", () => {
		runIntent("openProject", { onSelectMode, onStartTask })
		expect(openFolder).toHaveBeenCalledTimes(1)
		expect(onStartTask).not.toHaveBeenCalled()
		expect(onSelectMode).not.toHaveBeenCalled()
	})

	it.each(["addFeature", "buildFlashDebug", "buildFlash", "testValidate", "prototype", "demo"] as const)(
		"%s → starts a task with its built prompt",
		(id) => {
			runIntent(id, { onSelectMode, onStartTask })
			expect(onStartTask).toHaveBeenCalledTimes(1)
			expect(onStartTask).toHaveBeenCalledWith(buildIntentPrompt(id, undefined))
			expect(onSelectMode).not.toHaveBeenCalled()
		},
	)

	it("threads projectName into the prompt for project-scoped intents", () => {
		runIntent("addFeature", { onSelectMode, onStartTask, projectName: "central_uart" })
		expect(onStartTask).toHaveBeenCalledWith(buildIntentPrompt("addFeature", "central_uart"))
		expect(onStartTask.mock.calls[0][0]).toContain("central_uart")
	})

	it("demo intent carries the ADSUM_DEMO trigger so the host intercepts it", () => {
		runIntent("demo", { onSelectMode, onStartTask })
		expect(onStartTask.mock.calls[0][0]).toContain("[ADSUM_DEMO:nus-uart]")
	})

	it.each(["sdkMigration", "boardBringUp"] as const)("roadmap id %s never routes", (id) => {
		runIntent(id, { onSelectMode, onStartTask })
		expect(onStartTask).not.toHaveBeenCalled()
		expect(onSelectMode).not.toHaveBeenCalled()
		expect(openFolder).not.toHaveBeenCalled()
	})
})
