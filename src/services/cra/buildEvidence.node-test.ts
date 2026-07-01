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
		// path-specific: only the .config is readable; no pre-computed symbols.nm exists → the dump candidate misses
		// and we fall through to nm (which fails here).
		readText: (p) => (/\.config$/.test(p) ? "CONFIG_BT=y\n" : undefined),
		nm: () => undefined, // simulates execFileSync throwing / empty output
	}
	const ev = readBuildEvidence({ buildDir: "build" }, readers)
	assert.match(ev.dotConfig ?? "", /CONFIG_BT=y/)
	assert.equal(ev.symbols, undefined)
})

test("design/34 Sample bundle: a pre-computed zephyr/symbols.nm is read as symbols — nm is NEVER run", () => {
	let nmCalled = false
	const readers: BuildEvidenceReaders = {
		readText: (p) =>
			({ "build/zephyr/.config": "CONFIG_BT=y\n", "build/zephyr/symbols.nm": "0001 T bt_conn_le_create" })[
				p.replace(/\\/g, "/")
			],
		nm: () => {
			nmCalled = true
			return "SHOULD-NOT-BE-USED"
		},
	}
	const ev = readBuildEvidence({ buildDir: "build" }, readers)
	assert.match(ev.symbols ?? "", /bt_conn_le_create/)
	assert.equal(nmCalled, false, "nm must not run when a pre-computed symbols.nm exists")
})

test("design/34: explicit symbolsPath overrides everything (no nm, no ELF needed)", () => {
	const readers: BuildEvidenceReaders = {
		readText: (p) => (p === "/bundle/symbols.nm" ? "0002 T mbedtls_x509_crt_parse" : undefined),
		nm: () => {
			throw new Error("nm must not be called")
		},
	}
	const ev = readBuildEvidence({ symbolsPath: "/bundle/symbols.nm" }, readers)
	assert.match(ev.symbols ?? "", /mbedtls_x509_crt_parse/)
})

test("design/34: a real build with NO symbols.nm still runs nm on the ELF (unchanged path)", () => {
	const readers = readersFrom(
		{ "build/zephyr/.config": "CONFIG_BT=y\n" }, // no symbols.nm present
		{ "build/zephyr/zephyr.elf": "0003 T bt_le_scan_start" },
	)
	const ev = readBuildEvidence({ buildDir: "build" }, readers)
	assert.match(ev.symbols ?? "", /bt_le_scan_start/)
})
