import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { clearNrfEnvironmentCache, detectNrfEnvironment } from "@/services/nrf/EnvironmentDetector"
import { Controller } from ".."

export async function refreshNrfEnvironment(controller: Controller, _: EmptyRequest): Promise<Empty> {
	clearNrfEnvironmentCache()
	await detectNrfEnvironment()
	await controller.postStateToWebview()
	return Empty.create()
}
