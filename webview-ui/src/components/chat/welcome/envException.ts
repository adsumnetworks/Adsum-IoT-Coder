import type { EspDevice, EspEnvironment } from "@shared/esp"
import type { NrfEnvironment } from "@shared/nrf"

/**
 * The one thing about this machine that is worth interrupting for — or nothing.
 *
 * The collapsed environment line always said the same cheerful thing: `nRF ✓ · ESP ✓ · 2 boards`.
 * After the second day nobody reads it, which means the line costs 16 px permanently and pays back
 * only on the day something is wrong — the exact day it looks identical to every other day.
 *
 * So the line reports the EXCEPTION and is otherwise the summary it already was. A status line that
 * stays quiet while things are fine is one a developer starts trusting, and this is status, not a
 * verdict — which is why it is allowed a semantic colour under the golden rules.
 *
 * Deliberately narrow. Only two things qualify today, both of them states where the developer is
 * about to try something that cannot work:
 *
 *   - a serial device is present and esptool could not get an answer out of it
 *   - the nRF extension is installed but nrfutil is not, so nothing can be flashed
 *
 * "No boards connected" is NOT an exception. It is the ordinary state of a laptop on a train, and a
 * warning colour for it would be the boy who cried wolf on day one.
 */
export interface EnvException {
	label: "nRF" | "ESP"
	text: string
}

export function envException(nrf: NrfEnvironment | undefined, esp: EspEnvironment | undefined): EnvException | undefined {
	// ESP first: a board that is plugged in and silent is a live problem the developer is mid-way
	// through, where a missing toolchain is a setup task they can do later.
	if (esp?.status === "ready") {
		const stuck = (esp.espDevices ?? []).find((d: EspDevice) => !d.chip && !!d.probeError)
		if (stuck) {
			return { label: "ESP", text: "a serial device is not answering — open for detail" }
		}
	}
	if (nrf?.status === "ready" && nrf.extensionPresent && !nrf.nrfutilPresent) {
		return { label: "nRF", text: "nrfutil not found — nothing can be flashed" }
	}
	return undefined
}
