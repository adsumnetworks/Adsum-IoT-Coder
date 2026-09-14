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

/**
 * H5, 14 September: the list knew only the LEW840x, so a BLG20x workspace was never recognised — and the
 * agent in one run told the developer the only downloadable product family was the older gateway (B1).
 * Recognition comes from what a BLG20x PROJECT contains, not from which chips answer a probe: a developer
 * opens their project with no board attached as often as with one.
 */
describe("recognises a BLG20x project from what it contains, with no board attached", () => {
	test("the Zephyr board definition for the BLG20", () => {
		const root = mkroot()
		write(root, "boards/fanstel/blg20/board.yml", "board:\n  name: blg20\n  vendor: fanstel\n")
		const found = recogniseProduct([root])
		assert.equal(found?.id, "fanstel/blg20x")
		assert.match(found?.evidence ?? "", /board\.yml/)
	})

	test("an application overlay for one of its halves, one level down", () => {
		const root = mkroot()
		write(root, "nrf9151-app/prj.conf", "CONFIG_NRF_MODEM_LIB=y\n")
		write(root, "nrf9151-app/boards/blg20_nrf9151_ns.overlay", "/ { };\n")
		const found = recogniseProduct([root])
		assert.equal(found?.id, "fanstel/blg20x")
		assert.match(found?.evidence ?? "", /nrf9151-app/)
	})

	test("a build configured for the board", () => {
		const root = mkroot()
		write(root, "prj.conf", "CONFIG_BT=y\n")
		write(
			root,
			"build/build_info.yml",
			"cmake:\n  board:\n    name: blg20\n    qualifiers: nrf54lm20b/cpuapp\n  target: blg20_nrf54lm20b_cpuapp\n",
		)
		assert.equal(recogniseProduct([root])?.id, "fanstel/blg20x")
	})

	test("the prebuilt pair as our installer writes it, licence included", () => {
		const root = mkroot()
		write(root, "nrf9151/zephyr.signed.hex", ":00000001FF\n")
		write(root, "bm20/zephyr.signed.hex", ":00000001FF\n")
		write(root, "LICENSE-ADSUM.txt", "notice\n")
		assert.equal(recogniseProduct([root])?.id, "fanstel/blg20x")
	})

	test("its name in the project's README", () => {
		const root = mkroot()
		write(root, "README.md", "# Asset tracker on the BLG20XE02C\n")
		assert.equal(recogniseProduct([root])?.id, "fanstel/blg20x")
	})

	test("the older family is still recognised as itself", () => {
		const root = mkroot()
		write(root, "README.md", "# LEW840X gateway\n")
		assert.equal(recogniseProduct([root])?.id, "fanstel/lew840x")
	})

	test("an unrelated nRF9151 project is neither product", () => {
		const root = mkroot()
		write(root, "README.md", "# my tracker\n\nAn nRF9151 DK project with GNSS.\n")
		write(root, "prj.conf", "CONFIG_NRF_MODEM_LIB=y\nCONFIG_LTE_LINK_CONTROL=y\n")
		write(root, "boards/nrf9151dk_nrf9151_ns.overlay", "/ { };\n")
		write(root, "build/build_info.yml", "cmake:\n  board:\n    name: nrf9151dk\n  target: nrf9151dk_nrf9151_ns\n")
		assert.equal(recogniseProduct([root]), null)
	})

	test("half a prebuilt pair, or the pair without its licence, is not enough", () => {
		const a = mkroot()
		write(a, "nrf9151/zephyr.signed.hex", ":00000001FF\n")
		write(a, "LICENSE-ADSUM.txt", "notice\n")
		assert.equal(recogniseProduct([a]), null)
		const b = mkroot()
		write(b, "nrf9151/zephyr.signed.hex", ":00000001FF\n")
		write(b, "bm20/zephyr.signed.hex", ":00000001FF\n")
		assert.equal(recogniseProduct([b]), null)
	})

	test("the other variant's name, LBG20, is not this product", () => {
		const root = mkroot()
		write(root, "README.md", "# LBG20BC gateway\n")
		assert.equal(recogniseProduct([root]), null)
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
