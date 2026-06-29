import { StringRequest } from "@shared/proto/cline/common"
import { FileServiceClient } from "@/services/grpc-client"
import type { NordicModeId } from "../nordicModes"
import { buildIntentPrompt, type IntentId, type WorkspacePlatform } from "./welcomeIntents"

export interface IntentActionHandlers {
	onSelectMode: (mode: NordicModeId) => void
	onStartTask: (text: string) => void | Promise<void>
	/** Launch a bundled sample demo by id. Used when an intent has nothing real to act on (e.g. CRA with no project). */
	onStartDemo?: (scenarioId: string) => void
	projectName?: string
	platform?: WorkspacePlatform
	/** BLE project (CONFIG_BT=y) — drives the buildFlashDebug 3-layer observability branch. */
	hasBle?: boolean
}

/**
 * Single source of truth for what each intent card does on click — shared by the welcome
 * screen and the post-task NextStepChooser so both route identically.
 */
export function runIntent(id: IntentId, handlers: IntentActionHandlers): void {
	// Roadmap placeholders are rendered disabled and never route.
	if (id === "sdkMigration" || id === "boardBringUp") {
		return
	}
	if (id === "debug") {
		handlers.onSelectMode("log_analyzer")
	} else if (id === "openProject") {
		void FileServiceClient.openFolder(StringRequest.create({ value: "" }))
	} else if (id === "craCheck" && !handlers.projectName && handlers.onStartDemo) {
		// No project open → there's no real build to scan, so the CRA card runs the bundled sample demo
		// (matching its own "on a bundled sample — not your build" copy). Without this it sent the real-build
		// prompt and dead-ended on "no nRF/Zephyr project found" (F2). With a project open it falls through
		// to the real-build prompt below.
		handlers.onStartDemo("cra-sample")
	} else {
		// Neutral "both" when the platform is unknown — never silently assume nRF.
		void handlers.onStartTask(
			buildIntentPrompt(id, handlers.projectName ?? undefined, handlers.platform ?? "both", handlers.hasBle ?? false),
		)
	}
}
