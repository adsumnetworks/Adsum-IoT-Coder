import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { parseDependenciesLockIdfVersion } from "@/services/esp/EspEnvironmentDetector"
import { idfAmbiguousMessage, selectIdfInstall } from "../idfEnvResolver"

// Omar's exact installs (field report 2026-07-14).
const INSTALLS = [
	{ path: "C:\\esp\\v5.5.4\\esp-idf", version: "5.5.4" },
	{ path: "C:\\esp\\v6.0.2\\esp-idf", version: "6.0.2" },
]

// The lock body from the report — proves 5.5.4 is pinned.
const OMAR_LOCK = `dependencies:
  espressif/mdns:
    version: 1.11.3
  idf:
    source:
      type: idf
    version: 5.5.4
direct_dependencies:
- espressif/mdns
target: esp32
`

describe("ESP-IDF resolution — field report 2026-07-14", () => {
	test("the lock's pinned version parses (the value the tool said it couldn't find)", () => {
		assert.equal(parseDependenciesLockIdfVersion(OMAR_LOCK), "5.5.4")
	})

	test("a parsed pin resolves to its install — no ambiguity when the lock is honoured", () => {
		// This is the whole bug: the pin exists, so once resolution READS it (fresh, not from a stale cache)
		// selectIdfInstall resolves cleanly instead of returning ambiguous.
		const sel = selectIdfInstall(INSTALLS, "5.5.4")
		assert.equal(sel.kind, "resolved")
		assert.equal(sel.kind === "resolved" && sel.version, "5.5.4")
	})

	test("no pin + two installs is genuinely ambiguous (the correct ask)", () => {
		const sel = selectIdfInstall(INSTALLS, undefined)
		assert.equal(sel.kind, "ambiguous")
	})

	test("the explicit idf_version param resolves when passed", () => {
		const sel = selectIdfInstall(INSTALLS, undefined, undefined, { explicit: "6.0.2" })
		assert.equal(sel.kind === "resolved" && sel.version, "6.0.2")
	})

	test("the ambiguity message cites a REAL installed version, never the phantom 5.5.2", () => {
		const msg = idfAmbiguousMessage(INSTALLS)
		assert.doesNotMatch(msg, /5\.5\.2/, "5.5.2 was hardcoded and is not installed — must not appear")
		assert.match(msg, /idf_version="5\.5\.4"/, "should suggest a version the user actually has")
	})
})
