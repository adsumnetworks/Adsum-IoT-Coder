/**
 * U14 — the board-identity data bit.
 *
 * A lookup table in a bit is only worth the seam if reading it can never be worse than the constant
 * it replaced. So the assertions are mostly about failure: a corrupt cache, an unparsable block, no
 * HostProvider — each one has to fall through to the bundled copy without throwing, because this runs
 * while the prompt is being assembled and an exception there costs the developer their whole session.
 */

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { parseYamlBlock } from "./dataBits"

const ROOT = path.resolve(__dirname, "..", "..", "..")
const BIT = path.join(ROOT, "iot-knowledge/platforms/nrf/knowledge/board-identity.md")

const rows = () => {
	const table = parseYamlBlock(readFileSync(BIT, "utf8")) as { boards?: Array<{ pca: string; name: string }> }
	return table?.boards ?? []
}

describe("U14 — the bit carries a well-formed table", () => {
	test("the bit exists and its fenced yaml block parses", () => {
		assert.ok(existsSync(BIT), BIT)
		assert.ok(rows().length > 0, "the fenced yaml block must parse to boards[]")
	})

	test("every row has a PCA and a name, and PCAs are unique", () => {
		const seen = new Set<string>()
		for (const r of rows()) {
			assert.match(r.pca, /^PCA\d{5}$/, `bad pca: ${r.pca}`)
			assert.ok(typeof r.name === "string" && r.name.length > 0, `bad name for ${r.pca}`)
			assert.ok(!seen.has(r.pca), `duplicate ${r.pca} — two names for one board is worse than none`)
			seen.add(r.pca)
		}
	})

	test("the boards the bench actually uses are named", () => {
		const byPca = new Map(rows().map((r) => [r.pca, r.name]))
		assert.equal(byPca.get("PCA10056"), "nRF52840 DK")
		assert.equal(byPca.get("PCA10095"), "nRF5340 DK")
		assert.equal(byPca.get("PCA10059"), "nRF52840 Dongle")
	})

	test("PCA10100 is the nRF52833 DK — it was once mapped to the 5340 and shipped that way", () => {
		assert.equal(new Map(rows().map((r) => [r.pca, r.name])).get("PCA10100"), "nRF52833 DK")
	})

	test("the operator's nRF9151 SMA DK is named — PCA10201 shares a board target with PCA10171 but is its own kit", () => {
		const byPca = new Map(rows().map((r) => [r.pca, r.name]))
		assert.equal(byPca.get("PCA10201"), "nRF9151 SMA DK")
		assert.equal(byPca.get("PCA10171"), "nRF9151 DK")
	})

	test("the table the webview used to hold is fully carried over — nothing was dropped in the move", () => {
		// The constant that used to live in EnvStrip.tsx, verbatim. If a row went missing during the
		// migration a board would silently show as a bare PCA again, which is exactly the regression
		// this bit exists to end.
		const wasInTheWebview = [
			"PCA10028",
			"PCA10031",
			"PCA10040",
			"PCA10056",
			"PCA10059",
			"PCA10090",
			"PCA10095",
			"PCA10100",
			"PCA10112",
			"PCA10121",
			"PCA10143",
			"PCA10153",
			"PCA10156",
			"PCA10165",
			"PCA10171",
			"PCA10184",
			"PCA20020",
			"PCA20035",
			// Added to the webview table on 2026-09-06 (b7883cee) — after the bit was first cut, which is
			// how the two copies drifted: the host could not name the operator's own nRF9151 SMA DK
			// while the webview's fallback could. Carried into the bit with the webview's removal.
			"PCA10175",
			"PCA10188",
			"PCA10195",
			"PCA10201",
			"PCA10208",
			"PCA10214",
			"PCA10226",
			"PCA20053",
			"PCA20065",
		]
		const have = new Set(rows().map((r) => r.pca))
		assert.deepEqual(
			wasInTheWebview.filter((p) => !have.has(p)),
			[],
		)
	})
})

describe("U14 — a broken table must never be worse than no table", () => {
	test("a body with no fenced block parses to null, not to an empty table", () => {
		assert.equal(parseYamlBlock("# just prose\n\nno yaml here\n"), null)
	})

	test("a fenced block that is not valid yaml parses to null", () => {
		assert.equal(parseYamlBlock("```yaml\nboards:\n  - pca: [unclosed\n```\n"), null)
	})

	test("an unfenced table is NOT read — prose must never be mistaken for data", () => {
		assert.equal(parseYamlBlock("boards:\n  - pca: PCA10056\n    name: nRF52840 DK\n"), null)
	})

	test("the block is read even with a language tag variant", () => {
		assert.deepEqual(parseYamlBlock("```yml\nboards:\n  - pca: PCA1\n```\n"), { boards: [{ pca: "PCA1" }] })
	})
})

describe("U14 — the webview no longer carries the table", () => {
	test("PCA_NAMES is gone from EnvStrip", () => {
		const strip = readFileSync(path.join(ROOT, "webview-ui/src/components/chat/welcome/EnvStrip.tsx"), "utf8")
		assert.ok(!/PCA_NAMES/.test(strip), "the webview must not hold a second copy of the mapping")
		assert.match(strip, /b\.boardName \?\? b\.boardVersion/, "it must use the name the host resolved")
	})

	test("the host fills boardName on both detection paths", () => {
		const det = readFileSync(path.join(ROOT, "src/services/nrf/EnvironmentDetector.ts"), "utf8")
		assert.equal((det.match(/boardName: boardNameFor\(/g) ?? []).length, 2, "devkit and jlink paths both")
	})
})
