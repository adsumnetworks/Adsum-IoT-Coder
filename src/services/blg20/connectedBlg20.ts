import { type Blg20Unit, detectBlg20Units } from "@shared/blg20"
import type { NrfEnvironment } from "@shared/nrf"
import { getCachedSerialPorts } from "../esp/EspEnvironmentDetector"
import { getCachedBlg20UsbDevices, getCachedNrfEnvironment } from "../nrf/EnvironmentDetector"
import { getBleFacts, getCachedBleRows, lastBleScanError, lastBleScanTime, preferredBleGateway } from "./bleGateways"

/** The journey's facts on each unit over Bluetooth, and the picked unit first (the page's selection leads the list). */
function withJourney(units: Blg20Unit[]): Blg20Unit[] {
	const out = units.map((u) => {
		if (!u.bleId) return u
		const f = getBleFacts(u.bleId)
		return f ? { ...u, ...f } : u
	})
	const pick = preferredBleGateway()
	if (pick) {
		out.sort((a, b) => Number((b.bleId ?? "") === pick) - Number((a.bleId ?? "") === pick))
	}
	return out
}

/**
 * BLG20x gateways connected right now, from the two detectors' last results: the serial ports the ESP
 * detector enumerated (the service port), the targets behind the nRF probes (the chip pair), and nrfutil's
 * own device list (the service port again, for a computer whose python has no pyserial), and the last Bluetooth
 * scan (bleGateways.ts: the LBG20x's only service port). No probe of its own: the detectors re-run at activation,
 * on a workspace change and on ↻, and the Bluetooth scan on ↻ (and at start-up once a gateway was seen over it).
 */
export function getConnectedBlg20Units(): Blg20Unit[] {
	return withJourney(
		detectBlg20Units(
			getCachedSerialPorts(),
			getCachedNrfEnvironment().boards ?? [],
			getCachedBlg20UsbDevices(),
			getCachedBleRows(),
		),
	)
}

/** The nRF environment as the webview receives it: with the BLG20x units filled in. */
export function nrfEnvironmentWithBlg20(): NrfEnvironment {
	const env = getCachedNrfEnvironment()
	const at = lastBleScanTime()
	return {
		...env,
		blg20Units: withJourney(
			detectBlg20Units(getCachedSerialPorts(), env.boards ?? [], getCachedBlg20UsbDevices(), getCachedBleRows()),
		),
		...(at ? { bleScan: { at, ...(lastBleScanError() ? { error: lastBleScanError() } : {}) } } : {}),
	}
}
