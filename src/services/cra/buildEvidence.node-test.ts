/**
 * Tests for the build-evidence readers. fs + nm are injected — no real build needed.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { type BuildEvidenceReaders, readBuildEvidence } from "./buildEvidence"

const readersFrom = (files: Record<string, string>, symbols?: Record<string, string>): BuildEvidenceReaders => ({
	readText: (p) => files[p.replace(/\\/g, "/")],
	nm: (p) => symbols?.[p.replace(/\\/g, "/")],
})

test("Zephyr build: reads zephyr/.config and zephyr/zephyr.elf symbols", () => {
	const readers = readersFrom(
		{ "build/zephyr/.config": "CONFIG_BT=y\n" },
		{ "build/zephyr/zephyr.elf": "0001 T bt_hci_cmd_send" },
	)
	const ev = readBuildEvidence({ buildDir: "build" }, readers)
	assert.match(ev.dotConfig ?? "", /CONFIG_BT=y/)
	assert.match(ev.symbols ?? "", /bt_hci_cmd_send/)
})

test("ESP/flat build: falls back to <buildDir>/.config when zephyr/.config is absent", () => {
	const readers = readersFrom({ "build/.config": "CONFIG_MBEDTLS=y\n" })
	const ev = readBuildEvidence({ buildDir: "build" }, readers)
	assert.match(ev.dotConfig ?? "", /CONFIG_MBEDTLS=y/)
})

test("explicit paths override the buildDir candidates", () => {
	const readers = readersFrom({ "/custom/merged.config": "CONFIG_X=n\n" }, { "/custom/app.elf": "main" })
	const ev = readBuildEvidence({ dotConfigPath: "/custom/merged.config", elfPath: "/custom/app.elf" }, readers)
	assert.match(ev.dotConfig ?? "", /CONFIG_X=n/)
	assert.equal(ev.symbols, "main")
})

test("no build (nothing readable) → undefined evidence, never a throw (honest absence)", () => {
	const ev = readBuildEvidence({ buildDir: "build" }, readersFrom({}))
	assert.equal(ev.dotConfig, undefined)
	assert.equal(ev.symbols, undefined)
})

test("nm failure (wrong arch / missing tool) → symbols undefined, .config still read", () => {
	const readers: BuildEvidenceReaders = {
		readText: () => "CONFIG_BT=y\n",
		nm: () => undefined, // simulates execFileSync throwing / empty output
	}
	const ev = readBuildEvidence({ buildDir: "build" }, readers)
	assert.match(ev.dotConfig ?? "", /CONFIG_BT=y/)
	assert.equal(ev.symbols, undefined)
})
