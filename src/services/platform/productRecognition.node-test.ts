import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { recogniseProduct } from "./WorkspaceClassifier"

/**
 * Recognising a commercial product from the workspace itself.
 *
 * [BENCH 2026-09-04, I-28] The product index was consulted LESS in a real gateway workspace than
 * in an empty one: with no platform markers the product router is the only routing table and gets
 * followed, while with them the agent routes through platform knowledge and never reaches the
 * product index. Four symptom openers in a seeded gateway loaded it zero times. The row was
 * conditional on the developer naming the product — which nobody does when they are reporting a
 * symptom — so the workspace has to speak for itself, and only the host can read the disk.
 *
 * The risk this carries is naming the WRONG product: that sends an agent to read pin maps for
 * hardware the developer does not own, which is worse than saying nothing. So the tests below care
 * as much about what it refuses as what it finds.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/platform/productRecognition.node-test.ts
 */

const mkroot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "prod-"))
const write = (root: string, rel: string, body: string): void => {
	const p = path.join(root, rel)
	fs.mkdirSync(path.dirname(p), { recursive: true })
	fs.writeFileSync(p, body)
}

describe("recognises a product from what its own template wrote", () => {
	test("a README naming the gateway at the workspace root", () => {
		const root = mkroot()
		write(root, "README.md", "# LEW840X gateway\n\nBLE to MQTT.\n")
		const found = recogniseProduct([root])
		assert.equal(found?.id, "fanstel/lew840x")
		assert.match(found?.evidence ?? "", /README\.md/)
	})

	test("one level down, because a gateway is usually opened above its tree", () => {
		const root = mkroot()
		write(root, "gateway/BUILDLOG.md", "beat: b0 gate: pass — LEW840F-M2-V3\n")
		assert.equal(recogniseProduct([root])?.id, "fanstel/lew840x")
	})

	test("bench.json counts too — a build that got as far as recording its bench", () => {
		const root = mkroot()
		write(root, "gateway/.adsum/bench.json", '{"product":"LEW840X","lte":"absent"}')
		assert.equal(recogniseProduct([root])?.id, "fanstel/lew840x")
	})

	test("the lower-case spelling the operator prefers is recognised as the same product", () => {
		const root = mkroot()
		write(root, "README.md", "Fanstel LEW840x composable multi-radio gateway\n")
		assert.equal(recogniseProduct([root])?.id, "fanstel/lew840x")
	})

	test("it says WHERE it saw it, so the prompt can give evidence rather than assert", () => {
		const root = mkroot()
		write(root, "BUILDLOG.md", "LEW840X\n")
		assert.match(recogniseProduct([root])?.evidence ?? "", /Fanstel LEW840x named in BUILDLOG\.md/)
	})
})

describe("refuses to name a product it cannot actually see", () => {
	test("an empty workspace recognises nothing", () => {
		assert.equal(recogniseProduct([mkroot()]), null)
	})

	test("an ordinary firmware project is not a product", () => {
		const root = mkroot()
		write(root, "README.md", "# my-sensor\n\nAn nRF52840 project.\n")
		write(root, "prj.conf", "CONFIG_BT=y\n")
		assert.equal(recogniseProduct([root]), null)
	})

	test("a directory SHAPE alone is not enough — a coincidence must not name hardware", () => {
		// esp32/ + ble-scanner/ looks exactly like the gateway, and is not one unless something
		// says so. Guessing here sends an agent to pin maps for a board that is not on the desk.
		const root = mkroot()
		write(root, "esp32/sdkconfig", 'CONFIG_IDF_TARGET="esp32"\n')
		write(root, "ble-scanner/prj.conf", "CONFIG_BT=y\n")
		assert.equal(recogniseProduct([root]), null)
	})

	test("the name buried in a source file is not a marker — only the template's own files count", () => {
		const root = mkroot()
		write(root, "src/main.c", "/* ported from a LEW840X gateway */\n")
		assert.equal(recogniseProduct([root]), null)
	})

	test("a substring of a bigger word does not match", () => {
		const root = mkroot()
		write(root, "README.md", "Our XLEW840Xish naming scheme\n")
		assert.equal(recogniseProduct([root]), null)
	})

	test("an unreadable root is survivable, not fatal", () => {
		assert.doesNotThrow(() => recogniseProduct(["/definitely/not/a/path"]))
		assert.equal(recogniseProduct(["/definitely/not/a/path"]), null)
	})
})
