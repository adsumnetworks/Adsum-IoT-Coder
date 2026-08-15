import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { compareNcsVersions, ncsGateNotice } from "./ncsGate"

/**
 * The SDK version gate. A board bit can be correct and still describe a target the developer's installed
 * SDK does not have — the XIAO nRF54LM20A needs NCS >= 3.3.0, and nRF54LM20's `cpuflpr/xip` target is
 * documented upstream but absent from 3.3.1 entirely. Without this the agent reads the bit, believes the
 * target exists, and the developer finds out after a build.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/knowledge/kbit/ncsGate.test.ts
 */

describe("compareNcsVersions", () => {
	test("orders real NCS versions", () => {
		assert.equal(compareNcsVersions("3.3.1", "3.3.0"), 1)
		assert.equal(compareNcsVersions("3.3.0", "3.3.1"), -1)
		assert.equal(compareNcsVersions("3.3.0", "3.3.0"), 0)
		assert.equal(compareNcsVersions("3.4.0", "3.3.99"), 1)
		assert.equal(compareNcsVersions("2.8.0", "3.1.1"), -1)
	})

	test("tolerates the shapes Nordic actually ships", () => {
		// Toolchain manager reports "v3.3.1"; release tags carry suffixes.
		assert.equal(compareNcsVersions("v3.3.1", "3.3.1"), 0)
		assert.equal(compareNcsVersions("3.3.1", "3.3.1-rc1"), 0, "pre-release suffix is ignored")
		assert.equal(compareNcsVersions("2.9.0-nRF54H20-1", "2.9.0"), 0, "the H20-only tag compares as 2.9.0")
		assert.equal(compareNcsVersions("3.3", "3.3.0"), 0, "missing patch is zero")
	})
})

describe("the notice fires only when it should", () => {
	const base = { bitId: "adsum/nrf/boards/xiao-nrf54lm20a", title: "XIAO nRF54LM20A" }

	test("silent when the installed SDK is new enough", () => {
		assert.equal(ncsGateNotice({ ...base, minNcs: "3.3.0", installed: ["v3.3.1"] }), null)
	})

	test("silent when the bit declares no requirement", () => {
		assert.equal(ncsGateNotice({ ...base, installed: ["v2.0.0"] }), null)
	})

	test("warns when every installed toolchain is too old", () => {
		const n = ncsGateNotice({ ...base, minNcs: "3.3.0", installed: ["v3.2.0"] })
		assert.ok(n, "must warn")
		assert.match(n as string, /3\.3\.0/, "names the requirement")
		assert.match(n as string, /3\.2\.0/, "names what is installed")
		assert.match(n as string, /Toolchain Manager/i, "names the fix, not just the problem")
	})

	test("the newest installed toolchain wins — side-by-side installs are normal", () => {
		assert.equal(
			ncsGateNotice({ ...base, minNcs: "3.3.0", installed: ["v2.8.0", "v3.3.1", "v3.0.0"] }),
			null,
			"having a new enough one somewhere is what matters",
		)
	})

	test("nothing detected: still says what is needed", () => {
		// The developer may have no SDK at all — precisely when this matters most.
		const n = ncsGateNotice({ ...base, minNcs: "3.3.0", installed: [] })
		assert.ok(n)
		assert.match(n as string, /No NCS toolchain has been detected/i)
	})

	test("a project pinned below the requirement is called out even when a newer SDK exists", () => {
		const n = ncsGateNotice({ ...base, minNcs: "3.3.0", installed: ["v3.2.0"], projectPin: "v3.2.0" })
		assert.ok(n)
		assert.match(n as string, /pinned to v3\.2\.0/)
	})

	test("the real case: nRF54LM20 on the installed v3.3.1 is fine, on 3.1.1 is not", () => {
		assert.equal(ncsGateNotice({ ...base, minNcs: "3.3.0", installed: ["v3.3.1"] }), null)
		assert.ok(ncsGateNotice({ ...base, minNcs: "3.3.0", installed: ["v3.1.1"] }))
	})

	test("falls back to the bit id when a bit has no title", () => {
		const n = ncsGateNotice({ bitId: "adsum/nrf/boards/x", minNcs: "9.0.0", installed: ["v3.3.1"] })
		assert.match(n as string, /adsum\/nrf\/boards\/x/)
	})
})
