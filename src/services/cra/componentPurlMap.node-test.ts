/**
 * Tests for the curated component→PURL map (design/15 §5 / design/16 Fact-1 remedy). Honesty invariants: never
 * fabricate a version, only map verified coordinates, leave unmapped/version-less components as honest gaps.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { applyCuratedPurls, COMPONENT_PURL_MAP, curatedCount, curatedPurlFor, normalizeModuleName } from "./componentPurlMap"
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
