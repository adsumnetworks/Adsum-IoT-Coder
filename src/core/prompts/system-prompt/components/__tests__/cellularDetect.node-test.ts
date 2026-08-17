import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { NRF_CELLULAR_RE, NRF91_BOARD_RE } from "../../../../../services/platform/WorkspaceClassifier"
import { getBoardKnowledgeFile } from "../iot_context"

/**
 * nRF91 cellular detection.
 *
 * An nRF91 app is a Zephyr app built with the same NCS toolchain as an nRF52 app. Nothing in the project
 * shape distinguishes them, so before this the agent could not tell a cellular project from a BLE one —
 * and loaded BLE knowledge for a modem project.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/prompts/system-prompt/components/__tests__/cellularDetect.node-test.ts
 */

describe("cellular Kconfig detection", () => {
	test("the two switches every cellular app sets", () => {
		assert.ok(NRF_CELLULAR_RE.test("CONFIG_NRF_MODEM_LIB=y"))
		assert.ok(NRF_CELLULAR_RE.test("CONFIG_LTE_LINK_CONTROL=y"))
		assert.ok(NRF_CELLULAR_RE.test("CONFIG_LOG=y\nCONFIG_NRF_MODEM_LIB=y\nCONFIG_MAIN_STACK_SIZE=4096"))
	})

	test("whitespace and inline comments do not defeat it", () => {
		assert.ok(NRF_CELLULAR_RE.test("  CONFIG_NRF_MODEM_LIB = y  "))
		assert.ok(NRF_CELLULAR_RE.test("CONFIG_NRF_MODEM_LIB=y # the modem"))
	})

	test("a commented-out or disabled switch is NOT cellular", () => {
		// The same anchoring bug class as the BLE detector: a bare substring match would fire on both.
		assert.equal(NRF_CELLULaR_SAFE("#CONFIG_NRF_MODEM_LIB=y"), false)
		assert.equal(NRF_CELLULaR_SAFE("# CONFIG_NRF_MODEM_LIB=y"), false)
		assert.equal(NRF_CELLULaR_SAFE("CONFIG_NRF_MODEM_LIB=n"), false)
		assert.equal(NRF_CELLULaR_SAFE("CONFIG_NRF_MODEM_LIB is not set"), false)
	})

	test("a BLE-only project is not cellular", () => {
		assert.equal(NRF_CELLULaR_SAFE("CONFIG_BT=y\nCONFIG_BT_PERIPHERAL=y"), false)
	})
})

/** Fresh lastIndex each call — the shared regex is /im and must not carry state between assertions. */
function NRF_CELLULaR_SAFE(s: string): boolean {
	return new RegExp(NRF_CELLULAR_RE.source, NRF_CELLULAR_RE.flags).test(s)
}

describe("nRF91 board targets", () => {
	test("every DK Nordic ships, with and without the /ns suffix", () => {
		for (const t of [
			"nrf9160dk/nrf9160/ns",
			"nrf9161dk/nrf9161/ns",
			"nrf9151dk/nrf9151/ns",
			"nrf9161dk/nrf9161",
			"NRF9161DK/nrf9161/ns",
		]) {
			assert.ok(NRF91_BOARD_RE.test(t), t)
		}
	})

	test("nRF5x boards are not nRF91", () => {
		for (const t of ["nrf52840dk/nrf52840", "nrf5340dk/nrf5340/cpuapp", "xiao_nrf54lm20a/nrf54lm20a/cpuapp"]) {
			assert.equal(NRF91_BOARD_RE.test(t), false, t)
		}
	})
})

describe("board knowledge routing", () => {
	test("each nRF91 DK routes to its own bit", () => {
		assert.equal(getBoardKnowledgeFile("nrf9161dk/nrf9161/ns"), "platforms/nrf/boards/nrf9161dk.md")
		assert.equal(getBoardKnowledgeFile("nrf9160dk/nrf9160/ns"), "platforms/nrf/boards/nrf9160dk.md")
		assert.equal(getBoardKnowledgeFile("nrf9151dk/nrf9151/ns"), "platforms/nrf/boards/nrf9151dk.md")
	})

	test("adding nRF91 did not break nRF5x routing", () => {
		// The regression that matters: these all shipped in 0.2.1 and must be untouched.
		assert.equal(getBoardKnowledgeFile("nrf52840dk/nrf52840"), "platforms/nrf/boards/nrf52840.md")
		assert.equal(getBoardKnowledgeFile("nrf5340dk/nrf5340/cpuapp"), "platforms/nrf/boards/nrf5340.md")
		assert.equal(getBoardKnowledgeFile("Seeed Studio XIAO nRF54LM20A CMSIS-DAP"), "platforms/nrf/boards/xiao-nrf54lm20a.md")
	})

	test("9151 and 9161 do not collide — only the 9151 can do satellite", () => {
		// A one-digit difference decides whether NTN is possible at all. Getting this wrong would repeat
		// the nRF54 near-miss failure on a part where the consequence is a whole feature.
		assert.notEqual(getBoardKnowledgeFile("nrf9151dk/nrf9151/ns"), getBoardKnowledgeFile("nrf9161dk/nrf9161/ns"))
	})
})
