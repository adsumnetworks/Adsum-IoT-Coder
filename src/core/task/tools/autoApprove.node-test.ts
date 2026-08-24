import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { ClineDefaultTool } from "@shared/tools"
import type { StateManager } from "@/core/storage/StateManager"
import { AutoApprove } from "./autoApprove"

const approverWith = (settings: Record<string, unknown>, yolo = false) =>
	new AutoApprove({
		getGlobalSettingsKey: (key: string) =>
			key === "yoloModeToggled" ? yolo : { actions: settings, enabled: true, maxRequests: 1000 },
	} as unknown as StateManager)

const EDITS_ON = { readFiles: true, editFiles: true, editFilesExternally: false }

describe("what the developer turned on decides what runs unattended", () => {
	/**
	 * update_project_memory writes the project's status file into .adsum/ in the workspace — an ordinary
	 * file edit. It was missing from both switches, so it fell through to the blanket `return false` and
	 * asked for a click on EVERY update however much the developer had turned on, YOLO mode included.
	 *
	 * Caught on 2026-08-24 by a driven nRF9161 run that parked 90 seconds on a status write with every
	 * auto-approval enabled. Someone watching clicks it; an unattended run waits forever.
	 */
	test("writing the project status is an edit, and follows the edit setting", () => {
		assert.deepEqual(approverWith(EDITS_ON).shouldAutoApproveTool(ClineDefaultTool.UPDATE_MEMORY), [true, false])
	})

	test("edits off means the status write still asks", () => {
		const off = { ...EDITS_ON, editFiles: false }
		assert.deepEqual(approverWith(off).shouldAutoApproveTool(ClineDefaultTool.UPDATE_MEMORY), [false, false])
	})

	test("YOLO mode covers it too — it is not an exception to 'approve everything'", () => {
		assert.deepEqual(approverWith({}, true).shouldAutoApproveTool(ClineDefaultTool.UPDATE_MEMORY), [true, true])
	})

	test("it tracks the edit setting exactly, never its own rule", () => {
		const external = { ...EDITS_ON, editFilesExternally: true }
		assert.deepEqual(
			approverWith(external).shouldAutoApproveTool(ClineDefaultTool.UPDATE_MEMORY),
			approverWith(external).shouldAutoApproveTool(ClineDefaultTool.FILE_EDIT),
		)
	})
})
