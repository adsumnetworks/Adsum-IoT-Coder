import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { clearEspEnvironmentCache, detectEspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import { clearNrfEnvironmentCache, detectNrfEnvironment } from "@/services/nrf/EnvironmentDetector"
import { Controller } from ".."

export async function refreshNrfEnvironment(controller: Controller, _: EmptyRequest): Promise<Empty> {
	clearNrfEnvironmentCache()
	clearEspEnvironmentCache()
	await Promise.all([detectNrfEnvironment(), detectEspEnvironment()])
	await controller.postStateToWebview()
	return Empty.create()
}
