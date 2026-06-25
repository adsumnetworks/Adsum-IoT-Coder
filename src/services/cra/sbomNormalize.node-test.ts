/**
 * Tests for the SBOM normalizer (CVE scan loop). node:test, runs via `npm run test:cve` (ts-node) on the
 * default toolchain. Pure functions, no fixtures-on-disk needed.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeSbom, queryableComponents } from "./sbomNormalize"

const TAG_VALUE = `SPDXVersion: SPDX-2.3
DataLicense: CC0-1.0

PackageName: my_app
PackageVersion: 0.1.0

PackageName: mbedtls
PackageVersion: 3.5.0
ExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.5.0
ExternalRef: SECURITY cpe23Type cpe:2.3:a:arm:mbed_tls:3.5.0:*:*:*:*:*:*:*

PackageName: lwip
PackageVersion: 2.1.3
ExternalRef: PACKAGE-MANAGER purl pkg:github/lwip-tcpip/lwip@2.1.3

PackageName: vendor_blob
PackageVersion: 1.0
`

const JSON_SBOM = JSON.stringify({
	spdxVersion: "SPDX-2.3",
	packages: [
		{
			name: "esp_wifi",
			versionInfo: "5.1.2",
			externalRefs: [{ referenceType: "cpe23Type", referenceLocator: "cpe:2.3:a:espressif:esp_wifi:5.1.2:*:*:*:*:*:*:*" }],
		},
		{
			name: "mbedtls",
			versionInfo: "3.4.0",
			externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:github/Mbed-TLS/mbedtls@3.4.0" }],
		},
		{ name: "app", versionInfo: "0.1" },
	],
})

test("tag-value: parses components + extracts PURL and CPE", () => {
	const { components } = normalizeSbom(TAG_VALUE)
	const mbed = components.find((c) => c.name === "mbedtls")
	assert.ok(mbed)
	assert.equal(mbed?.version, "3.5.0")
	assert.equal(mbed?.purl, "pkg:github/Mbed-TLS/mbedtls@3.5.0")
	assert.equal(mbed?.cpe, "cpe:2.3:a:arm:mbed_tls:3.5.0:*:*:*:*:*:*:*")
})

test("tag-value: coverage counts + per-component record (queryable, byDropReason)", () => {
	const { components, coverage } = normalizeSbom(TAG_VALUE)
	assert.deepEqual(coverage, {
		total: 4,
		withPurl: 2,
		withCpe: 1,
		unidentified: 2,
		queryable: 2, // mbedtls (purl), lwip (purl)
		byDropReason: { "no-id": 2 }, // my_app, vendor_blob — named+versioned but no machine id
	})
	// §5: the per-component coverage fact is stored ON the component (single source of truth).
	assert.equal(components.find((c) => c.name === "mbedtls")?.queryable, true)
	assert.equal(components.find((c) => c.name === "mbedtls")?.dropReason, null)
	assert.equal(components.find((c) => c.name === "vendor_blob")?.dropReason, "no-id")
})

test("json: parses versionInfo + externalRefs (purl & cpe)", () => {
	const { components, coverage } = normalizeSbom(JSON_SBOM)
	assert.equal(components.length, 3)
	assert.equal(components.find((c) => c.name === "esp_wifi")?.cpe?.startsWith("cpe:2.3:a:espressif"), true)
	assert.equal(components.find((c) => c.name === "mbedtls")?.purl, "pkg:github/Mbed-TLS/mbedtls@3.4.0")
	assert.deepEqual(coverage, {
		total: 3,
		withPurl: 1,
		withCpe: 1,
		unidentified: 1,
		queryable: 1, // mbedtls (purl)
		byDropReason: { "cpe-only": 1, "no-id": 1 }, // esp_wifi (cpe-only), app (no id)
	})
})

test("queryableComponents = those with an OSV-usable id (a PURL); cpe-only + unidentified excluded", () => {
	const sbom = normalizeSbom(TAG_VALUE)
	const q = queryableComponents(sbom)
	assert.equal(q.length, 2) // mbedtls (purl), lwip (purl); my_app + vendor_blob excluded
	assert.equal(
		q.every((c) => !!c.purl),
		true,
	)
})

test("malformed JSON → empty, not a throw", () => {
	assert.deepEqual(normalizeSbom("{ not valid json"), {
		components: [],
		coverage: { total: 0, withPurl: 0, withCpe: 0, unidentified: 0, queryable: 0, byDropReason: {} },
	})
})

test("empty input → zero coverage", () => {
	assert.equal(normalizeSbom("").coverage.total, 0)
})
