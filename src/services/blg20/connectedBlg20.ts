import { type Blg20Unit, detectBlg20Units } from "@shared/blg20"
import type { NrfEnvironment } from "@shared/nrf"
import { getCachedSerialPorts } from "../esp/EspEnvironmentDetector"
import { getCachedBlg20UsbDevices, getCachedNrfEnvironment } from "../nrf/EnvironmentDetector"

/**
 * BLG20x gateways connected right now, from the two detectors' last results: the serial ports the ESP
 * detector enumerated (the service port), the targets behind the nRF probes (the chip pair), and nrfutil's
 * own device list (the service port again, for a computer whose python has no pyserial). No probe of its
 * own: both detectors already re-run at activation, on a workspace change and on ↻.
 */
export function getConnectedBlg20Units(): Blg20Unit[] {
	return detectBlg20Units(getCachedSerialPorts(), getCachedNrfEnvironment().boards ?? [], getCachedBlg20UsbDevices())
}

/** The nRF environment as the webview receives it: with the BLG20x units filled in. */
export function nrfEnvironmentWithBlg20(): NrfEnvironment {
	const env = getCachedNrfEnvironment()
	return { ...env, blg20Units: detectBlg20Units(getCachedSerialPorts(), env.boards ?? [], getCachedBlg20UsbDevices()) }
}
