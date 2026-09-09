import { describe, expect, it } from "vitest"
import { envException } from "../envException"

const espReady = (devices: unknown[]) =>
	({ status: "ready", extensionPresent: true, idfPresent: true, projectDetected: true, espDevices: devices }) as never
const nrfReady = (over: Record<string, unknown> = {}) =>
	({ status: "ready", extensionPresent: true, nrfutilPresent: true, boards: [], ...over }) as never

describe("the environment line reports the exception, not the summary", () => {
	it("says nothing when everything resolves — that is what makes it worth reading", () => {
		expect(envException(nrfReady(), espReady([{ port: "/dev/cu.a", chip: "ESP32-S3" }]))).toBeUndefined()
	})

	it("a silent serial device is an exception", () => {
		const e = envException(
			nrfReady(),
			espReady([{ port: "/dev/cu.usbserial-0001", vid: 0x10c4, probeError: "No serial data received." }]),
		)
		expect(e?.label).toBe("ESP")
		expect(e?.text).toMatch(/not answering/)
	})

	it("a device that RESOLVED is not an exception, even beside one that did not", () => {
		// Order must not matter: one good board does not mask a bad one, and one bad one does not
		// condemn a good one.
		const e = envException(
			nrfReady(),
			espReady([
				{ port: "/dev/cu.a", chip: "ESP32-S3" },
				{ port: "/dev/cu.b", probeError: "No serial data received." },
			]),
		)
		expect(e?.label).toBe("ESP")
	})

	it("nrfutil missing is an exception — nothing can be flashed without it", () => {
		expect(envException(nrfReady({ nrfutilPresent: false }), undefined)?.label).toBe("nRF")
	})

	it("NO BOARDS CONNECTED IS NOT AN EXCEPTION", () => {
		// The ordinary state of a laptop on a train. A warning colour here is the boy who cried wolf
		// on day one, and then the line is worth nothing on the day it matters.
		expect(envException(nrfReady({ boards: [] }), espReady([]))).toBeUndefined()
	})

	it("nothing is claimed while detection is still running", () => {
		expect(envException({ status: "detecting" } as never, { status: "detecting" } as never)).toBeUndefined()
		expect(envException(undefined, undefined)).toBeUndefined()
	})
})
