import { StringRequest } from "@shared/proto/cline/common"
import { AgentSessionJson } from "@shared/proto/cline/state"
import { getHandoverStripById } from "@/services/handover/HandoverUiState"
import type { Controller } from ".."

/**
 * One agent session, by id — what the history list opens.
 *
 * Returns the strip as JSON rather than modelling it in proto: the identical shape already crosses to the
 * webview inside ExtensionState.handoverUi, so a second, drifting definition would buy nothing. An empty
 * string means the session's record is gone from disk; the caller says so instead of rendering a shell.
 */
export async function getAgentSession(_controller: Controller, request: StringRequest): Promise<AgentSessionJson> {
	const strip = getHandoverStripById(request.value)
	return AgentSessionJson.create({ value: strip ? JSON.stringify(strip) : "" })
}
