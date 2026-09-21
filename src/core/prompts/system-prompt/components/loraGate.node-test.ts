import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * What makes a workspace a LoRa project.
 *
 * TWO signals, because one is not enough, and the second is the one that matters.
 *
 * 2026-09-21: the LEW840X LoRa radio was brought up with a complete `semtech,sx1262` devicetree node,
 * a real SPI bus and `CONFIG_LORA` deliberately OFF — so that a hand-written probe could own the bus
 * and fail with the name of a wire, instead of Zephyr's driver failing with one opaque line. That
 * session found three bugs that each cost a day. A Kconfig-only gate would have loaded nothing for
 * the entire session that produced the knowledge.
 *
 * The regexes are duplicated here rather than imported: they are one line each, and a test that reads
 * the source's own pattern passes no matter what that pattern says.
 *
 * But duplication alone rots. The DECT gate block in `__tests__/kbitVisibility.node-test.ts` pairs the
 * copy with an assertion that the source STILL contains it, so a change on one side fails loudly
 * instead of quietly leaving the test measuring a pattern nobody uses. Same here.
 */
const CTX = path.join(process.cwd(), "src", "core", "prompts", "system-prompt", "components", "iot_context.ts")
const LORA_KCONFIG = /^\s*CONFIG_LORA\w*\s*=\s*y/im
const LORA_DEVICETREE = /semtech,sx12/i
const ESP_LORA = /sx12[67]x|sx126[128]|sx127[6-9]|lora|radiolib/i

describe("recognising a LoRa project from its configuration", () => {
	test("the test is checking the same patterns the source uses", () => {
		const ctx = fs.readFileSync(CTX, "utf8")
		for (const re of [LORA_KCONFIG, LORA_DEVICETREE, ESP_LORA]) {
			assert.ok(ctx.includes(String(re)), `iot_context.ts no longer uses ${re} — update this test`)
		}
	})

	test("the driver Kconfigs are matched", () => {
		for (const line of ["CONFIG_LORA=y", "CONFIG_LORA_SX126X=y", "CONFIG_LORA_SX127X=y", "  CONFIG_LORA=y  "]) {
			assert.ok(LORA_KCONFIG.test(`${line}\n`), line)
		}
	})

	test("a commented-out or disabled symbol is not intent", () => {
		assert.ok(!LORA_KCONFIG.test("# CONFIG_LORA is not set\n"))
		assert.ok(!LORA_KCONFIG.test("CONFIG_LORA=n\n"))
	})

	test("a BLE-only project does not drag LoRa in", () => {
		const bleOnly = "CONFIG_BT=y\nCONFIG_BT_OBSERVER=y\nCONFIG_SPI=y\nCONFIG_GPIO=y\n"
		assert.ok(!LORA_KCONFIG.test(bleOnly), "LoRa knowledge is not free — it loads when it is needed")
		assert.ok(!LORA_DEVICETREE.test(bleOnly))
	})

	test("THE CASE THE KCONFIG GATE MISSES: a real radio with the driver switched off", () => {
		// The overlay from the bench session, trimmed. CONFIG_LORA is absent on purpose.
		const overlay = [
			"&spi1 {",
			'\tcompatible = "nordic,nrf-spim";',
			"\tcs-gpios = <&gpio0 22 GPIO_ACTIVE_LOW>;",
			"\tlora: lora@0 {",
			'\t\tcompatible = "semtech,sx1262";',
			"\t\treset-gpios = <&gpio0 20 GPIO_ACTIVE_LOW>;",
			"\t\tbusy-gpios  = <&gpio0 21 GPIO_ACTIVE_HIGH>;",
			"\t\tdio1-gpios  = <&gpio0 14 GPIO_ACTIVE_HIGH>;",
			"\t};",
			"};",
		].join("\n")
		const prj = "CONFIG_BT=y\nCONFIG_SPI=y\nCONFIG_SPI_NRFX=y\n"

		assert.ok(!LORA_KCONFIG.test(prj), "the session that produced our LoRa knowledge set no CONFIG_LORA")
		assert.ok(LORA_DEVICETREE.test(overlay), "and the devicetree is what makes it a LoRa project")
	})

	test("the devicetree pattern reaches both families in one test", () => {
		for (const compat of ["semtech,sx1261", "semtech,sx1262", "semtech,sx1268", "semtech,sx1276", "semtech,sx1278"]) {
			assert.ok(LORA_DEVICETREE.test(`compatible = "${compat}";`), compat)
		}
	})

	test("it does not fire on an unrelated devicetree", () => {
		const uart = 'compatible = "nordic,nrf-uarte";\npsels = <NRF_PSEL(UART_TX, 0, 26)>;'
		assert.ok(!LORA_DEVICETREE.test(uart))
	})

	test("the ESP side reads a component dependency, because IDF ships no driver", () => {
		const manifest = ["dependencies:", '  dernasherbrezon/sx127x: "^4.0.0"', '  idf: ">=5.0"'].join("\n")
		assert.ok(ESP_LORA.test(manifest), "the registry component is the only evidence there is")

		const radiolib = 'dependencies:\n  jgromes/radiolib: "^7.0.0"\n'
		assert.ok(ESP_LORA.test(radiolib), "RadioLib is the other common choice and names no part")
	})

	test("the ESP side does not fire on an ordinary manifest", () => {
		const plain = ["dependencies:", '  idf: ">=5.0"', '  espressif/mdns: "^1.2.0"'].join("\n")
		assert.ok(!ESP_LORA.test(plain))
	})
})
