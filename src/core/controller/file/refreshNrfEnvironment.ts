import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { scanBleGateways } from "@/services/blg20/bleGateways"
import { nrfEnvironmentWithBlg20 } from "@/services/blg20/connectedBlg20"
import { clearEspEnvironmentCache, detectEspEnvironment, getCachedEspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import { clearNrfEnvironmentCache, detectNrfEnvironment } from "@/services/nrf/EnvironmentDetector"
import { setAdsumStatusBarTooltip } from "@/services/statusbar/AdsumStatusBar"
import { Controller } from ".."

export async function refreshNrfEnvironment(controller: Controller, _: EmptyRequest): Promise<Empty> {
	clearNrfEnvironmentCache()
	clearEspEnvironmentCache()
	// ↻ is the developer asking for the desk to be read, so it includes the Bluetooth scan (the LBG20x is only there).
	await Promise.all([detectNrfEnvironment(), detectEspEnvironment(), scanBleGateways("refresh")])
	setAdsumStatusBarTooltip(nrfEnvironmentWithBlg20(), getCachedEspEnvironment())
	await controller.postStateToWebview()
	return Empty.create()
}
