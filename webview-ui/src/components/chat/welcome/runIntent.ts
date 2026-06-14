import { StringRequest } from "@shared/proto/cline/common"
import { FileServiceClient } from "@/services/grpc-client"
import type { NordicModeId } from "../nordicModes"
import { buildIntentPrompt, type IntentId, type WorkspacePlatform } from "./welcomeIntents"

export interface IntentActionHandlers {
	onSelectMode: (mode: NordicModeId) => void
	onStartTask: (text: string) => void | Promise<void>
	projectName?: string
	platform?: WorkspacePlatform
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
	} else {
		// Neutral "both" when the platform is unknown — never silently assume nRF.
		void handlers.onStartTask(buildIntentPrompt(id, handlers.projectName ?? undefined, handlers.platform ?? "both"))
	}
}
