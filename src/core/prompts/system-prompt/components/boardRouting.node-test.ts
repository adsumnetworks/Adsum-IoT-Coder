import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"
import { getBoardKnowledgeFile, getEspBoardKnowledgeFile } from "./iot_context"

/**
 * Board-target → knowledge-file routing.
 *
 * These are substring tests over strings that nest inside one another, which is exactly the shape that
 * produces a silent wrong answer rather than an error: "xiao_nrf54lm20a/nrf54lm20a/cpuapp" contains
 * "nrf54lm20a", and "nrf54lm20" contains "nrf54l". Route a XIAO to the DK bit and the agent gets the wrong
 * pins and the wrong flashing route while everything looks fine.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/prompts/system-prompt/components/boardRouting.node-test.ts
 */

describe("nRF54 routing — most specific first", () => {
	test("the XIAO module wins over the nRF54LM20 DK despite sharing the SoC name", () => {
		assert.equal(
			getBoardKnowledgeFile("xiao_nrf54lm20a/nrf54lm20a/cpuapp"),
			"platforms/nrf/boards/xiao-nrf54lm20a.md",
			"a XIAO must never load DK knowledge",
		)
	})

	test("both nRF54LM20 DK SoC variants route to the DK bit", () => {
		for (const t of ["nrf54lm20dk/nrf54lm20a/cpuapp", "nrf54lm20dk/nrf54lm20b/cpuapp", "nrf54lm20dk/nrf54lm20b/cpuflpr"]) {
			assert.equal(getBoardKnowledgeFile(t), "platforms/nrf/boards/nrf54lm20dk.md", t)
		}
	})

	test("the L10 and L05 emulation targets route to the L15 DK — they exist only on that board", () => {
		for (const t of [
			"nrf54l15dk/nrf54l15/cpuapp",
			"nrf54l15dk/nrf54l15/cpuapp/ns",
			"nrf54l15dk/nrf54l15/cpuflpr/xip",
			"nrf54l15dk/nrf54l10/cpuapp",
			"nrf54l15dk/nrf54l05/cpuapp",
		]) {
			assert.equal(getBoardKnowledgeFile(t), "platforms/nrf/boards/nrf54l15dk.md", t)
		}
	})
})

describe("existing routing is unchanged", () => {
	test("nRF52 and nRF53 still resolve", () => {
		assert.equal(getBoardKnowledgeFile("nrf52840dk/nrf52840"), "platforms/nrf/boards/nrf52840.md")
		assert.equal(getBoardKnowledgeFile("nrf52dk/nrf52832"), "platforms/nrf/boards/nrf52832.md")
		assert.equal(getBoardKnowledgeFile("nrf5340dk/nrf5340/cpuapp"), "platforms/nrf/boards/nrf5340.md")
	})

	test("an unknown board resolves to nothing rather than guessing", () => {
		// Deliberately a part that does not exist. This case used to name the nRF9160 DK, which WAS unknown
		// when it was written and has since been given both a route and a bit — so the test failed while the
		// router was the more correct of the two. An "unknown board" example has to be one nobody will ever
		// author, or it decays into a false alarm the moment the corpus grows.
		assert.equal(getBoardKnowledgeFile("nrf0000dk/nrf0000"), null)
		assert.equal(getBoardKnowledgeFile(""), null)
	})

	test("the nRF9160 DK, which is no longer unknown, routes to its own bit", () => {
		assert.equal(getBoardKnowledgeFile("nrf9160dk/nrf9160"), "platforms/nrf/boards/nrf9160dk.md")
	})

	test("case does not matter", () => {
		assert.equal(getBoardKnowledgeFile("NRF54L15DK/NRF54L15/CPUAPP"), "platforms/nrf/boards/nrf54l15dk.md")
	})
})

describe("every routed file actually exists", () => {
	const TARGETS = [
		"nrf52840dk/nrf52840",
		"nrf52dk/nrf52832",
		"nrf5340dk/nrf5340/cpuapp",
		"nrf54l15dk/nrf54l15/cpuapp",
		"nrf54lm20dk/nrf54lm20b/cpuapp",
		"xiao_nrf54lm20a/nrf54lm20a/cpuapp",
	]

	// Always checkable: routing is pure string work, so a board that falls through to `null` is a bug here
	// and nowhere else. This half needs no corpus and therefore holds in a bare checkout too.
	test("every supported board routes somewhere", () => {
		const unrouted = TARGETS.filter((t) => !getBoardKnowledgeFile(t))
		assert.deepEqual(unrouted, [], `boards with no route: ${unrouted.join(", ")}`)
	})

	// A route pointing at a missing file loads nothing and says nothing — the worst failure mode, because
	// the agent proceeds with no board knowledge and no indication that any was expected. Board bits are
	// registry-delivered, so their home is the SIBLING Adsum-Backend/kbits, not a subdirectory of this repo;
	// when that sibling is absent (a bare clone, public CI) there is nothing to resolve against and the
	// check above is the whole test.
	/**
	 * The ESP half, which this suite never covered — and the gap is live.
	 *
	 * `getEspBoardKnowledgeFile` routes four targets; only two of them have a bit in either home. The
	 * bench's own board is an ESP32-C6, so an ESP session there is assembled with no board knowledge and
	 * no sign that any was expected. Declared rather than skipped, so the day a bit is authored the list
	 * shrinks instead of the gap being forgotten.
	 */
	const ESP_TARGETS = ["esp32s3", "esp32c6", "esp32c3", "esp32"]
	const ESP_KNOWN_MISSING = new Set(["platforms/esp/boards/esp32-c6.md", "platforms/esp/boards/esp32-c3.md"])

	test("every ESP target this router claims routes somewhere", () => {
		const unrouted = ESP_TARGETS.filter((t) => !getEspBoardKnowledgeFile(t))
		assert.deepEqual(unrouted, [], `ESP targets with no route: ${unrouted.join(", ")}`)
	})

	test("no ESP route is a dead link, except the gaps named above", () => {
		const roots = [path.join(process.cwd(), "iot-knowledge"), path.join(process.cwd(), "..", "Adsum-Backend", "kbits")].filter(
			(r) => fs.existsSync(r),
		)
		if (!roots.some((r) => r.includes("Adsum-Backend"))) {
			return // sibling registry folder absent — file existence is unknowable from here
		}
		const missing: string[] = []
		const fixed: string[] = []
		for (const t of ESP_TARGETS) {
			const rel = getEspBoardKnowledgeFile(t)
			if (!rel) {
				continue
			}
			const exists = roots.some((r) => fs.existsSync(path.join(r, rel)))
			if (!exists && !ESP_KNOWN_MISSING.has(rel)) {
				missing.push(`${t} → ${rel}`)
			}
			if (exists && ESP_KNOWN_MISSING.has(rel)) {
				fixed.push(rel)
			}
		}
		assert.deepEqual(missing, [], `ESP routes pointing at files that do not exist:\n${missing.join("\n")}`)
		assert.deepEqual(fixed, [], `these bits now exist — remove them from ESP_KNOWN_MISSING:\n${fixed.join("\n")}`)
	})

	test("no route is a dead link", () => {
		const roots = [
			path.join(process.cwd(), "iot-knowledge"),
			path.join(process.cwd(), "..", "Adsum-Backend", "kbits"),
		].filter((r) => fs.existsSync(r))
		if (!roots.some((r) => r.includes("Adsum-Backend"))) {
			return // sibling registry folder absent — file existence is unknowable from here
		}
		const missing: string[] = []
		for (const t of TARGETS) {
			const rel = getBoardKnowledgeFile(t)
			if (rel && !roots.some((r) => fs.existsSync(path.join(r, rel)))) {
				missing.push(`${t} → ${rel} (not in iot-knowledge/ nor ../Adsum-Backend/kbits/)`)
			}
		}
		assert.deepEqual(missing, [], `routes pointing at files that do not exist:\n${missing.join("\n")}`)
	})
})
