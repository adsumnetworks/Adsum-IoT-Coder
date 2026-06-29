/**
 * Tests for the west → version resolver. Honesty invariants: only report versions west actually pins; a raw
 * commit SHA is an honest MISS (undefined), never a mis-matchable PURL.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { applyCuratedPurls } from "./componentPurlMap"
import { normalizeSbom } from "./sbomNormalize"
import {
	isLikelyVersion,
	makeModuleVersionResolver,
	parseEspIdfVersion,
	parseWestList,
	parseWestManifest,
	parseZephyrVersionH,
} from "./westVersions"

const WEST_LIST = `mcuboot        v2.1.0
mbedtls        v3.6.5
hal_nordic     abadc0ffee0123456789abadc0ffee0123456789
zephyr         v3.7.0
`

const WEST_YML = `manifest:
  remotes:
    - name: ncs
      url-base: https://github.com/nrfconnect
  projects:
    - name: mcuboot
      revision: v2.1.0
      path: bootloader/mcuboot
    - name: openthread
      revision: thread-reference-20230706
    - name: nrfxlib
      revision: 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567
`

test("parseWestList: 'name revision' lines → canonical map; underscores normalized", () => {
	const v = parseWestList(WEST_LIST)
	assert.equal(v.mcuboot, "v2.1.0")
	assert.equal(v["hal-nordic"], "abadc0ffee0123456789abadc0ffee0123456789") // _ → -
	assert.equal(Object.keys(v).length, 4)
})

test("parseWestList: tolerates blank lines / extra whitespace", () => {
	assert.deepEqual(parseWestList("\n  mcuboot   v2.1.0  \n\n"), { mcuboot: "v2.1.0" })
})

test("parseWestManifest: manifest.projects[] → map", () => {
	const v = parseWestManifest(WEST_YML)
	assert.equal(v.mcuboot, "v2.1.0")
	assert.equal(v.openthread, "thread-reference-20230706")
	assert.equal(v.nrfxlib, "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567")
})

test("parseWestManifest: malformed YAML → empty (never throws)", () => {
	assert.deepEqual(parseWestManifest("{not: valid: yaml:"), {})
})

test("isLikelyVersion: tags/semver yes, 40-hex commit SHA no", () => {
	assert.equal(isLikelyVersion("v2.1.0"), true)
	assert.equal(isLikelyVersion("3.6.5"), true)
	assert.equal(isLikelyVersion("hostap_2_11"), true)
	assert.equal(isLikelyVersion("1234567890123456789012345678901234567890"), false) // commit SHA
	assert.equal(isLikelyVersion("main"), false)
})

test("makeModuleVersionResolver: returns a pinned tag; a commit-SHA module → undefined (honest miss)", () => {
	const resolve = makeModuleVersionResolver(parseWestList(WEST_LIST))
	assert.equal(resolve("mcuboot-deps"), "v2.1.0") // resolver is fed the SBOM's "<name>-deps"
	assert.equal(resolve("hal_nordic"), undefined) // SHA-pinned → honest miss, not a bad PURL
	assert.equal(resolve("not-in-manifest"), undefined)
})

test("END-TO-END: west list → resolver → curated map raises coverage on a version-less NCS SBOM", () => {
	const ncs = `SPDXVersion: SPDX-2.3

PackageName: mcuboot-deps

PackageName: hal_nordic-deps
`
	const resolve = makeModuleVersionResolver(parseWestList(WEST_LIST))
	const after = applyCuratedPurls(normalizeSbom(ncs), resolve)
	// mcuboot: mapped coordinate + pinned tag → queryable PURL. hal_nordic: SHA-pinned → stays an honest gap.
	const mcuboot = after.components.find((c) => c.name === "mcuboot-deps")
	assert.equal(mcuboot?.purl, "pkg:github/mcu-tools/mcuboot@v2.1.0")
	assert.equal(after.coverage.queryable, 1)
})

test("parseEspIdfVersion: git_revision is the reliable IDF version source (ground-truthed esp-idf v6.0.1)", () => {
	// Real shape: v6.0.1's project_description.json has git_revision but NO idf_version.
	assert.equal(parseEspIdfVersion(JSON.stringify({ git_revision: "v6.0.1", version: "1.3" })), "6.0.1")
	// Some IDF versions carry idf_version — accepted as a fallback.
	assert.equal(parseEspIdfVersion(JSON.stringify({ idf_version: "v5.3.1" })), "5.3.1")
	// git_revision wins when both present; a -dirty/-suffix is stripped to the semver prefix.
	assert.equal(parseEspIdfVersion(JSON.stringify({ git_revision: "v5.4.0-dirty", idf_version: "v5.3.1" })), "5.4.0")
	// Not an ESP build / no tag / garbage → undefined (honest miss, never a fabricated version).
	assert.equal(parseEspIdfVersion(JSON.stringify({ version: "1.3" })), undefined)
	assert.equal(parseEspIdfVersion("{not json"), undefined)
})

test("parseZephyrVersionH: reads the build's generated version.h (survives a /tmp sample copy; the 2806i fix)", () => {
	// Real shape from <build>/zephyr/include/generated/zephyr/version.h on an NCS 3.2.1 build.
	const real = `#define KERNEL_VERSION_MAJOR            4
#define KERNEL_VERSION_MINOR            2
#define KERNEL_PATCHLEVEL               99
#define KERNEL_VERSION_STRING           "4.2.99"`
	assert.equal(parseZephyrVersionH(real), "4.2.99")
	// Falls back to the MAJOR/MINOR/PATCHLEVEL triple if the string macro is absent.
	assert.equal(
		parseZephyrVersionH("#define KERNEL_VERSION_MAJOR 3\n#define KERNEL_VERSION_MINOR 6\n#define KERNEL_PATCHLEVEL 0"),
		"3.6.0",
	)
	// Not a version header → undefined (honest miss, never fabricates).
	assert.equal(parseZephyrVersionH("// nothing here"), undefined)
})
