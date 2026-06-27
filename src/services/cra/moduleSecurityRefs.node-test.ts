/** Tests for the zephyr/module.yml security-refs reader (F5). node:test via `npm run test:cve`. */
import assert from "node:assert/strict"
import { test } from "node:test"
import { parseModuleSecurityRefs } from "./moduleSecurityRefs"

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
