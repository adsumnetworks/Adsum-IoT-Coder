/** Tests for the zephyr/module.yml security-refs reader (F5). node:test via `npm run test:cve`. */
import assert from "node:assert/strict"
import { test } from "node:test"
import { applyModuleRefs, parseModuleSecurityRefs } from "./moduleSecurityRefs"
import { normalizeSbom } from "./sbomNormalize"

const MBEDTLS_MODULE_YML = `name: mbedtls
security:
  external-references:
    - cpe:2.3:a:arm:mbed_tls:3.5.2:*:*:*:*:*:*:*
    - pkg:github/Mbed-TLS/mbedtls@3.5.2
`

test("parseModuleSecurityRefs: splits cpe + purl, captures the module name", () => {
	const r = parseModuleSecurityRefs(MBEDTLS_MODULE_YML)
	assert.equal(r.name, "mbedtls")
	assert.deepEqual(r.cpes, ["cpe:2.3:a:arm:mbed_tls:3.5.2:*:*:*:*:*:*:*"])
	assert.deepEqual(r.purls, ["pkg:github/Mbed-TLS/mbedtls@3.5.2"])
})

test("parseModuleSecurityRefs: module with no security block → empty refs (name kept)", () => {
	const r = parseModuleSecurityRefs("name: foo\nbuild:\n  cmake: .\n")
	assert.equal(r.name, "foo")
	assert.deepEqual(r.cpes, [])
	assert.deepEqual(r.purls, [])
})

test("parseModuleSecurityRefs: malformed yaml → empty, never throws", () => {
	const r = parseModuleSecurityRefs(":\n  - [unbalanced")
	assert.deepEqual(r.cpes, [])
	assert.deepEqual(r.purls, [])
})

test("applyModuleRefs: fills the CPE/PURL the SBOM tool didn't emit, making the component queryable", () => {
	const sbom = normalizeSbom("SPDXVersion: SPDX-2.3\n\nPackageName: mbedtls\nPackageVersion: 3.5.2\n")
	const resolve = () => ({ cpes: ["cpe:2.3:a:arm:mbed_tls:3.5.2:*:*:*:*:*:*:*"], purls: ["pkg:github/Mbed-TLS/mbedtls@3.5.2"] })
	const c = applyModuleRefs(sbom, resolve).components.find((x) => x.name === "mbedtls")
	assert.equal(c?.cpe, "cpe:2.3:a:arm:mbed_tls:3.5.2:*:*:*:*:*:*:*")
	assert.equal(c?.purl, "pkg:github/Mbed-TLS/mbedtls@3.5.2")
})

test("applyModuleRefs: a tool-emitted PURL is never overwritten by module.yml", () => {
	const sbom = normalizeSbom(
		"SPDXVersion: SPDX-2.3\n\nPackageName: mbedtls\nPackageVersion: 3.5.2\nExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.5.2\n",
	)
	const resolve = () => ({ cpes: [], purls: ["pkg:other/wrong@1"] })
	const c = applyModuleRefs(sbom, resolve).components.find((x) => x.name === "mbedtls")
	assert.equal(c?.purl, "pkg:github/Mbed-TLS/mbedtls@3.5.2")
})
