import assert from "node:assert/strict"
import { describe, test } from "node:test"

/**
 * Which prj.conf symbols mean "this is a GNSS project".
 *
 * 2026-08-29: a mission whose entire subject was "read a GPS fix and publish it over MQTT" on an nRF9161
 * loaded LTE.md and never GNSS.md. The gate was inside the cellular block and keyed on nRF9151-or-NTN, so
 * a GNSS project on any other nRF91 part could not reach it at all — and the task never set CONFIG_NTN.
 *
 * The regex is duplicated here rather than exported: it is one line, and a test that reads the source's
 * own pattern would pass no matter what that pattern said.
 */
const GNSS_INTENT = /^\s*CONFIG_\w*GNSS\w*\s*=\s*y/im

describe("recognising a GNSS project from its configuration", () => {
	test("the canonical symbol is matched, and GNSS is not a prefix in it", () => {
		assert.ok(GNSS_INTENT.test("CONFIG_NRF_MODEM_GNSS=y\n"), "CONFIG_NRF_MODEM_GNSS is THE symbol")
	})

	test("the other real spellings are matched too", () => {
		for (const line of [
			"CONFIG_GNSS=y",
			"CONFIG_GNSS_SATELLITES=y",
			"CONFIG_LTE_NETWORK_MODE_LTE_M_GNSS=y",
			"CONFIG_NRF_MODEM_GNSS_AGNSS=y",
			"  CONFIG_NRF_MODEM_GNSS=y  ",
		]) {
			assert.ok(GNSS_INTENT.test(`${line}\n`), line)
		}
	})

	test("a commented-out or disabled symbol is not intent", () => {
		assert.ok(!GNSS_INTENT.test("# CONFIG_NRF_MODEM_GNSS is not set\n"))
		assert.ok(!GNSS_INTENT.test("CONFIG_NRF_MODEM_GNSS=n\n"))
	})

	test("a cellular-only project does not drag GNSS in", () => {
		const cellularOnly = "CONFIG_NRF_MODEM_LIB=y\nCONFIG_LTE_LINK_CONTROL=y\nCONFIG_MQTT_LIB=y\n"
		assert.ok(!GNSS_INTENT.test(cellularOnly), "GNSS knowledge is not free — it loads when it is needed")
	})

	test("the incident's own prj.conf would have fired it", () => {
		// From /tmp/gnss_mqtt_9161 on the bench, the project that got LTE.md and no GNSS.md.
		const incident = [
			"CONFIG_NETWORKING=y",
			"CONFIG_LTE_LINK_CONTROL=y",
			"CONFIG_LTE_NETWORK_MODE_LTE_M_GPS=y",
			"CONFIG_NRF_MODEM_LIB=y",
			"CONFIG_NRF_MODEM_GNSS=y",
		].join("\n")
		assert.ok(GNSS_INTENT.test(incident))
	})
})
