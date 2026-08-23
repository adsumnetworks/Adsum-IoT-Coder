/**
 * U11 — the shipped decoder bundles must produce exactly what their source produces.
 *
 * The two decoders live once, as TypeScript under `src/services/nrf/`, and are bundled into Tool bits
 * by `scripts/build-tool-bundles.mjs`. Their existing suites test the TypeScript. This suite tests the
 * thing that actually ships, on the same fixture, and asserts the two agree byte for byte.
 *
 * Without it the arrangement is worse than either alternative: an edit to the source that never made
 * it into the bundle would leave a green test suite describing code no developer runs.
 */

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { decodeSnifferPcap } from "./sniffer/format"

const ROOT = path.resolve(__dirname, "..", "..", "..")
const SNIFFER_BUNDLE = path.join(ROOT, "iot-knowledge/platforms/nrf/tools/sniffer-decode/sniffer_decode.mjs")
const HCI_BUNDLE = path.join(ROOT, "iot-knowledge/platforms/nrf/tools/hci-decode/hci_decode.mjs")
const PCAP = path.join(ROOT, "src/services/nrf/sniffer/__tests__/fixtures/real-adv-and-scan.pcap")

/** Run a bundle and parse its JSON. A big capture blows past Node's 1 MB default, hence the buffer. */
function runBundle(bundle: string, args: string[]): { code: number; json: Record<string, unknown> } {
	try {
		const out = execFileSync(process.execPath, [bundle, ...args, "--json"], {
			encoding: "utf8",
			timeout: 60000,
			maxBuffer: 64 * 1024 * 1024,
		})
		return { code: 0, json: JSON.parse(out) }
	} catch (e) {
		const err = e as { status?: number; stdout?: string }
		return { code: err.status ?? 1, json: err.stdout ? JSON.parse(err.stdout) : {} }
	}
}

describe("U11 — sniffer-decode: bundle output equals source output", () => {
	test("the bundle exists (run `npm run build:tool-bundles` if this fails)", () => {
		assert.ok(existsSync(SNIFFER_BUNDLE), SNIFFER_BUNDLE)
	})

	test("identical text and frame count on the real capture", () => {
		const fromSource = decodeSnifferPcap(readFileSync(PCAP))
		const { code, json } = runBundle(SNIFFER_BUNDLE, ["--in", PCAP])
		assert.equal(code, 0)
		assert.equal(json.status, "ok")
		assert.equal(json.totalFrames, fromSource.result.totalFrames)
		assert.equal(json.text, fromSource.text, "the shipped decoder must not differ from the tested one")
	})

	test("the fixture is the real one, not a stub — a trivial capture would prove nothing", () => {
		const { json } = runBundle(SNIFFER_BUNDLE, ["--in", PCAP])
		assert.ok((json.totalFrames as number) > 1000, `expected a substantial capture, got ${json.totalFrames}`)
		assert.ok((json.text as string).length > 100_000, "the decode must be large enough to exercise buffering")
	})
})

describe("U11 — the honest-failure contract survives bundling", () => {
	test("an EMPTY capture is a capture failure, not a decode of zero packets", () => {
		const empty = path.join(ROOT, "iot-knowledge/platforms/nrf/tools/sniffer-decode/TOOL.md") // any file; emptiness is faked below
		assert.ok(existsSync(empty))
		// Use a genuinely empty file via /dev/null, which exists on the platforms this runs on.
		const { code, json } = runBundle(SNIFFER_BUNDLE, ["--in", "/dev/null"])
		assert.equal(code, 2, "an empty capture must not exit 0")
		assert.equal(json.status, "bad-input")
		assert.match(String(json.reason), /empty/i)
	})

	test("a missing file is exit 2 with a reason, never a silent empty decode", () => {
		const { code, json } = runBundle(SNIFFER_BUNDLE, ["--in", "/nonexistent/x.pcap"])
		assert.equal(code, 2)
		assert.equal(json.status, "bad-input")
	})

	test("hci-decode applies the same contract", () => {
		assert.ok(existsSync(HCI_BUNDLE), HCI_BUNDLE)
		const missing = runBundle(HCI_BUNDLE, ["--in", "/nonexistent/x.btmon"])
		assert.equal(missing.code, 2)
		const empty = runBundle(HCI_BUNDLE, ["--in", "/dev/null"])
		assert.equal(empty.code, 2)
		assert.match(String(empty.json.reason), /empty/i)
	})
})

describe("U11 — the MIT attribution travels with the artifact", () => {
	test("the bundle itself still names LogScope after bundling", () => {
		// esbuild strips ordinary `//` comments; the notice is a `/*! @license` block for this reason,
		// and the build does not minify. Both together are what keep the attribution in the shipped file.
		assert.match(readFileSync(HCI_BUNDLE, "utf8"), /LogScope/)
	})

	test("NOTICE is a declared artifact, so it is fetched and hash-checked like the code", () => {
		const descriptor = readFileSync(path.join(path.dirname(HCI_BUNDLE), "TOOL.md"), "utf8")
		assert.match(descriptor, /- path: NOTICE\n\s+sha256: [0-9a-f]{64}/)
		const notice = readFileSync(path.join(path.dirname(HCI_BUNDLE), "NOTICE"), "utf8")
		assert.match(notice, /MIT License/)
		assert.match(notice, /logscope/i)
	})
})
