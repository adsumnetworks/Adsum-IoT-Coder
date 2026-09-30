import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, test } from "node:test"
import { ESP_LORA_RE, LORA_DT_COMPAT_RE, NRF_LORA_CONFIG_RE } from "./iot_context"

/**
 * What makes a workspace a LoRa project, on either SDK.
 *
 * [30 Sep 2026] The LoRa corpus is registered-tier knowledge that lives under `wireless/`, off every
 * platform's own tree, so nothing loaded it unless the prompt builder asked. The gates read the same
 * three patterns exported from iot_context.ts, so this test checks what the code runs and not a copy.
 */
describe("recognising a LoRa project", () => {
	test("NCS: CONFIG_LORA and its family are intent; a disabled or commented symbol is not", () => {
		for (const line of ["CONFIG_LORA=y", "CONFIG_LORA_SX126X=y", "  CONFIG_LORA_SX127X=y  ", "CONFIG_LORA_SHELL=y"]) {
			assert.ok(NRF_LORA_CONFIG_RE.test(`${line}\n`), line)
		}
		assert.ok(!NRF_LORA_CONFIG_RE.test("# CONFIG_LORA is not set\n"))
		assert.ok(!NRF_LORA_CONFIG_RE.test("CONFIG_LORA=n\n"))
		assert.ok(!NRF_LORA_CONFIG_RE.test("CONFIG_BT=y\nCONFIG_NRF_MODEM_LIB=y\n"), "BLE or cellular alone is not LoRa")
	})

	test("NCS: a Semtech node in a devicetree overlay is intent, whichever part", () => {
		for (const compat of ["semtech,sx1262", "semtech,sx1276", "semtech,sx1268", "SEMTECH,SX1272"]) {
			assert.ok(LORA_DT_COMPAT_RE.test(`lora0: lora@0 {\n\tcompatible = "${compat}";\n};\n`), compat)
		}
		assert.ok(!LORA_DT_COMPAT_RE.test('compatible = "nordic,nrf-spim";'))
	})

	test("ESP-IDF: a Semtech driver, RadioLib, or a lora component is intent; ordinary Wi-Fi projects are not", () => {
		for (const text of ['dependencies:\n  radiolib: "*"\n', "CONFIG_SX1262_ENABLED=y", "sx127x\n", "espressif/lora: 1.0.0"]) {
			assert.ok(ESP_LORA_RE.test(text), text)
		}
		assert.ok(!ESP_LORA_RE.test("CONFIG_WIFI_ENABLED=y\nCONFIG_BT_ENABLED=y\n"))
		assert.ok(!ESP_LORA_RE.test("colorado"), "the word inside another word is not intent")
	})

	test("the files the gate reads are where a real project keeps them", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "lora-gate-"))
		try {
			await mkdir(path.join(dir, "boards"))
			await writeFile(
				path.join(dir, "boards", "nrf52840dk_nrf52840.overlay"),
				'&spi1 {\n\tlora0: lora@0 { compatible = "semtech,sx1262"; };\n};\n',
			)
			await writeFile(path.join(dir, "main_idf_component.yml"), 'dependencies:\n  radiolib: "*"\n')
			// The regexes are the contract; the gate's file walk is exercised through the prompt builder in
			// the bench run (plan E, test 5), because it needs the host's file helpers.
			assert.ok(
				LORA_DT_COMPAT_RE.test(
					await (await import("node:fs/promises")).readFile(
						path.join(dir, "boards", "nrf52840dk_nrf52840.overlay"),
						"utf-8",
					),
				),
			)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})
