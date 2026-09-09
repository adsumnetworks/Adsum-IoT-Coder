import { describe, expect, it } from "vitest"
import { platformVerdicts } from "../EnvStrip"

/**
 * One fact, two densities, one verdict. The header row renders from this and only this, so it can
 * never tick a platform the strip calls "not detected". [OPERATOR 2026-09-09, v2]
 */
const nrf = (o: any) => ({ status: "ready", extensionPresent: false, nrfutilPresent: false, boards: [], ...o }) as any
const esp = (o: any) =>
	({ status: "ready", extensionPresent: false, idfPresent: false, projectDetected: false, espDevices: [], ...o }) as any

describe("platformVerdicts — the strip's verdict, at word length", () => {
	it("nothing detected → no platforms at all (the row names the next act)", () => {
		expect(platformVerdicts(nrf({}), esp({}), true)).toEqual([])
	})
	it("nRF Connect present → ready ✓, with the strip's own toolchain words", () => {
		const [v] = platformVerdicts(nrf({ extensionPresent: true, nrfutilPresent: true }), undefined, true)
		expect(v).toMatchObject({ label: "nRF", state: "ready", toolchain: "nRF Connect ✓" })
	})
	it("nrfutil alone is NOT ready — the strip says 'nRF Connect not detected', so does the row", () => {
		const [v] = platformVerdicts(nrf({ nrfutilPresent: true }), undefined, true)
		expect(v).toMatchObject({ state: "missing", toolchain: "nRF Connect not detected" })
	})
	it("boards are the strip's own labels, in order", () => {
		const [v] = platformVerdicts(
			nrf({
				extensionPresent: true,
				nrfutilPresent: true,
				boards: [{ productName: "nRF52840 DK" }, { boardVersion: "PCA10095", boardName: "nRF5340 DK" }],
			}),
			undefined,
			true,
		)
		expect(v.boards).toEqual(["nRF52840 DK", "nRF5340 DK"])
	})
	it("ESP-IDF on disk without the extension is still a toolchain the strip does not mute → ready", () => {
		const [v] = platformVerdicts(undefined, esp({ idfPresent: true }), false)
		expect(v).toMatchObject({ label: "ESP", state: "ready", toolchain: "ESP-IDF installed" })
	})
	it("an ESP device that will not answer is the exception, in envException's words", () => {
		const [v] = platformVerdicts(
			undefined,
			esp({
				extensionPresent: true,
				idfPresent: true,
				espDevices: [{ vid: 0x10c4, pid: 0xea60, probeError: "No serial data received" }],
			}),
			true,
		)
		expect(v.state).toBe("exception")
		expect(v.exception).toMatch(/not answering/)
	})
	it("nRF Connect without nrfutil is the nRF exception — nothing can be flashed", () => {
		const [v] = platformVerdicts(nrf({ extensionPresent: true, nrfutilPresent: false }), undefined, true)
		expect(v).toMatchObject({ state: "exception" })
		expect(v.exception).toMatch(/nrfutil not found/)
	})
	it("while detecting, the verdict says so rather than guessing", () => {
		const [v] = platformVerdicts(nrf({ status: "detecting", extensionPresent: true, nrfutilPresent: true }), undefined, true)
		expect(v.state).toBe("detecting")
	})
})
