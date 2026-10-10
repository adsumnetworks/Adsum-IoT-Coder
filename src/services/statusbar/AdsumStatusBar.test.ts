import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { buildStatusBarTooltip, formatStatusText, pickHeadline, unitLabel } from "./AdsumStatusBar"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/statusbar/AdsumStatusBar.test.ts
 */
const nrf = (
	boards: Array<{ deviceName?: string; productName?: string }> = [],
	blg20Units: Array<{ name?: string; servicePort?: string }> = [],
) => ({ status: "ready", extensionPresent: true, nrfutilPresent: true, boards, blg20Units }) as never

describe("the status bar leads with one word after the mark", () => {
	test("Adsum alone, never Coder", () => {
		assert.equal(formatStatusText(), "$(adsum-iot-coder-icon) Adsum")
		assert.equal(formatStatusText(6_600_000), "$(adsum-iot-coder-icon) Adsum · $(zap) 6.6M")
	})
	test("the unit by its own name", () => {
		assert.equal(unitLabel(nrf([], [{ name: "286C", servicePort: "/dev/tty.usbmodem2861" }])), "BLG20x 286C")
		assert.equal(unitLabel(nrf([{ productName: "nRF52840 DK" }])), "nRF52840 DK")
		assert.equal(unitLabel(nrf()), undefined)
		assert.equal(formatStatusText(6_600_000, "BLG20x 286C"), "$(adsum-iot-coder-icon) Adsum · BLG20x 286C · $(zap) 6.6M")
	})
	test("a session waiting on an answer beats the unit", () => {
		const sessions = [
			{ taskId: "a", title: "LEW840x gateway build", waiting: false, streaming: true, active: true },
			{ taskId: "b", title: "BLG20x 286C · set it up", waiting: true, streaming: false, active: false },
		]
		assert.equal(pickHeadline(sessions, "nRF52840 DK"), "BLG20x 286C waiting")
		assert.equal(pickHeadline([sessions[0]], "nRF52840 DK"), "nRF52840 DK")
	})
	test("the tooltip lists both platforms, the holders and the sessions", () => {
		const tip = buildStatusBarTooltip(
			nrf([{ deviceName: "nRF52840 DK" }], [{ name: "286C", servicePort: "/dev/tty.usbmodem2861" }]),
			{ status: "ready", extensionPresent: false, idfPresent: true, espDevices: [{ chip: "ESP32-C6" }] } as never,
			[{ taskId: "a", title: "LEW840x gateway build", waiting: true, streaming: false, active: true }],
			[{ port: "/DEV/TTYACM0", title: "LEW840x gateway build" }],
		)
		assert.match(tip, /nRF52840 DK/)
		assert.match(tip, /BLG20x 286C · \/dev\/tty\.usbmodem2861/)
		assert.match(tip, /ESP-IDF present/)
		assert.match(tip, /ESP32-C6/)
		assert.match(tip, /held by LEW840x gateway build/)
		assert.match(tip, /waiting on you/)
	})
})
