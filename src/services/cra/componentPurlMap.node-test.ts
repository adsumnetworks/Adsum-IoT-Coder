/**
 * Tests for the curated component→PURL map (design/15 §5 / design/16 Fact-1 remedy). Honesty invariants: never
 * fabricate a version, only map verified coordinates, leave unmapped/version-less components as honest gaps.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import {
	applyCuratedCpes,
	applyCuratedPurls,
	COMPONENT_CPE_MAP,
	COMPONENT_PURL_MAP,
	curatedCount,
	curatedCpeFor,
	curatedPurlFor,
	normalizeModuleName,
} from "./componentPurlMap"
import { normalizeSbom } from "./sbomNormalize"

test("normalizeModuleName: strips -deps, lowercases, _→-", () => {
	assert.equal(normalizeModuleName("mbedtls-deps"), "mbedtls")
	assert.equal(normalizeModuleName("hal_nordic"), "hal-nordic")
	assert.equal(normalizeModuleName("MCUboot-deps"), "mcuboot")
	assert.equal(normalizeModuleName("trusted-firmware-m-deps"), "trusted-firmware-m")
})

test("INVARIANT: every map entry has a pkg: coordinate + a verifiedNote (no unverified mapping ships)", () => {
	for (const [name, c] of Object.entries(COMPONENT_PURL_MAP)) {
		assert.match(c.coordinate, /^pkg:/, `${name} coordinate must be a PURL`)
		assert.ok(c.verifiedNote && c.verifiedNote.length > 0, `${name} needs a verifiedNote`)
	}
})

test("the three self-validated coordinates match what the real ncs-sbom emitted (design/16)", () => {
	assert.equal(COMPONENT_PURL_MAP.mbedtls.coordinate, "pkg:github/Mbed-TLS/mbedtls")
	assert.equal(COMPONENT_PURL_MAP.hostap.coordinate, "pkg:generic/hostap")
	assert.equal(COMPONENT_PURL_MAP["trusted-firmware-m"].coordinate, "pkg:generic/trusted-firmware-m")
})

test("curatedPurlFor: coordinate + version → PURL; never fabricates a version", () => {
	assert.equal(curatedPurlFor("mcuboot-deps", "2.1.0"), "pkg:github/mcu-tools/mcuboot@2.1.0")
	assert.equal(curatedPurlFor("mbedtls", undefined), undefined) // no version → no PURL
	assert.equal(curatedPurlFor("totally-unknown-module", "1.0"), undefined) // unmapped → no PURL
})

// A synthetic SBOM shaped like a real NCS modules-deps (names "<module>-deps", NO version, NO purl).
const NCS_SHAPED = `SPDXVersion: SPDX-2.3

PackageName: mcuboot-deps

PackageName: openthread-deps

PackageName: some-proprietary-blob-deps
`

test("applyCuratedPurls: NO version source → version-less components stay honest gaps (coverage unchanged)", () => {
	const before = normalizeSbom(NCS_SHAPED)
	assert.equal(before.coverage.queryable, 0)
	const after = applyCuratedPurls(before) // no resolver, no embedded versions
	assert.equal(after.coverage.queryable, 0) // nothing fabricated
	assert.equal(curatedCount(after), 0)
})

test("applyCuratedPurls: WITH a version resolver (the operator's west.yml) → mapped modules become queryable", () => {
	const versions: Record<string, string> = { mcuboot: "2.1.0", openthread: "thread-reference-20230706" }
	const after = applyCuratedPurls(normalizeSbom(NCS_SHAPED), (n) => versions[n])
	assert.equal(after.coverage.queryable, 2) // mcuboot + openthread now have PURLs
	assert.equal(curatedCount(after), 2)
	const mcuboot = after.components.find((c) => c.name === "mcuboot-deps")
	assert.equal(mcuboot?.purl, "pkg:github/mcu-tools/mcuboot@2.1.0")
	assert.equal(mcuboot?.purlSource, "curated")
	// the unmapped proprietary blob stays an honest gap
	const blob = after.components.find((c) => c.name === "some-proprietary-blob-deps")
	assert.equal(blob?.purl, undefined)
	assert.equal(blob?.queryable, false)
})

test("applyCuratedPurls: a tool-emitted PURL is preserved + marked source 'tool' (map never overrides)", () => {
	const withPurl = `SPDXVersion: SPDX-2.3

PackageName: mbedtls-deps
ExternalRef: PACKAGE_MANAGER purl pkg:github/Mbed-TLS/mbedtls@v3.6.5
`
	const after = applyCuratedPurls(normalizeSbom(withPurl), () => "9.9.9")
	const mbed = after.components[0]
	assert.equal(mbed.purl, "pkg:github/Mbed-TLS/mbedtls@v3.6.5") // tool purl kept, NOT replaced by the resolver version
	assert.equal(mbed.purlSource, "tool")
	assert.equal(curatedCount(after), 0)
})

test("applyCuratedPurls: a component carrying its OWN version (no purl) is mapped without a resolver", () => {
	const sbom = normalizeSbom(`SPDXVersion: SPDX-2.3

PackageName: lz4-deps
PackageVersion: 1.9.4
`)
	const after = applyCuratedPurls(sbom)
	assert.equal(after.components[0].purl, "pkg:github/lz4/lz4@1.9.4")
	assert.equal(after.components[0].purlSource, "curated")
})

// --- curated CPE map (platform cores the SBOM tool omits — Zephyr/MCUboot) ---

test("normalizeModuleName: strips -sources too (zephyr-sources → zephyr, the west spdx core name)", () => {
	assert.equal(normalizeModuleName("zephyr-sources"), "zephyr")
})

test("COMPONENT_CPE_MAP: every entry has a cpe:2.3 prefix + a verifiedNote", () => {
	for (const [k, v] of Object.entries(COMPONENT_CPE_MAP)) {
		assert.match(v.prefix, /^cpe:2\.3:[oah]:/, `${k} prefix must be a CPE 2.3 vendor:product`)
		assert.ok(v.verifiedNote.length > 0, `${k} needs a verifiedNote`)
	}
})

test("curatedCpeFor: semver → CPE; a git SHA → undefined (never fabricates a version match)", () => {
	assert.equal(curatedCpeFor("zephyr", "4.2.99"), "cpe:2.3:o:zephyrproject:zephyr:4.2.99:*:*:*:*:*:*:*")
	assert.equal(curatedCpeFor("zephyr-sources", "v4.2.99"), "cpe:2.3:o:zephyrproject:zephyr:4.2.99:*:*:*:*:*:*:*")
	assert.equal(curatedCpeFor("zephyr", "ec78104f15691cccd94682cf4b22e0a013f28dd8"), undefined) // SHA → no CPE
	assert.equal(curatedCpeFor("zephyr", undefined), undefined)
	assert.equal(curatedCpeFor("totally-unknown", "4.2.99"), undefined) // unmapped → no CPE
})

test("curatedCpeFor: esp-idf core → NVD-verified CPE (design/25 Tranche B, ESP parity)", () => {
	assert.equal(curatedCpeFor("esp-idf", "6.0.1"), "cpe:2.3:a:espressif:esp-idf:6.0.1:*:*:*:*:*:*:*")
	assert.equal(curatedCpeFor("esp-idf", "v5.3.1"), "cpe:2.3:a:espressif:esp-idf:5.3.1:*:*:*:*:*:*:*")
})

test("applyCuratedCpes: the SHA-versioned Zephyr core + a semver resolver → CPE filled, NVD-queryable", () => {
	// Real shape: west spdx emits the Zephyr core as `zephyr-sources` with a git SHA and NO CPE/PURL.
	const sbom = normalizeSbom(`SPDXVersion: SPDX-2.3

PackageName: zephyr-sources
PackageVersion: ec78104f15691cccd94682cf4b22e0a013f28dd8-dirty
`)
	const before = sbom.components[0]
	assert.equal(before.cpe, undefined)
	// No resolver → the SHA can't form a CPE → stays an honest gap (no fabrication).
	assert.equal(applyCuratedCpes(sbom).components[0].cpe, undefined)
	// With a semver resolver (zephyr/VERSION) → CPE filled, marked curated, now CPE-bearing (NVD-queryable).
	const after = applyCuratedCpes(sbom, (n) => (n === "zephyr" ? "4.2.99" : undefined))
	const z = after.components[0]
	assert.equal(z.cpe, "cpe:2.3:o:zephyrproject:zephyr:4.2.99:*:*:*:*:*:*:*")
	assert.equal(z.cpeSource, "curated")
	assert.equal(after.coverage.withCpe, 1)
})
