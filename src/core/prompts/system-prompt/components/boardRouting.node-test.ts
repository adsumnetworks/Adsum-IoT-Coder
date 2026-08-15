import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"
import { getBoardKnowledgeFile } from "./iot_context"

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
		assert.equal(getBoardKnowledgeFile("nrf9160dk/nrf9160"), null)
		assert.equal(getBoardKnowledgeFile(""), null)
	})

	test("case does not matter", () => {
		assert.equal(getBoardKnowledgeFile("NRF54L15DK/NRF54L15/CPUAPP"), "platforms/nrf/boards/nrf54l15dk.md")
	})
})

describe("every routed file actually exists", () => {
	// A route pointing at a missing file loads nothing and says nothing — the worst failure mode, because
	// the agent proceeds with no board knowledge and no indication that any was expected.
	test("no route is a dead link", () => {
		const targets = [
			"nrf52840dk/nrf52840",
			"nrf52dk/nrf52832",
			"nrf5340dk/nrf5340/cpuapp",
			"nrf54l15dk/nrf54l15/cpuapp",
			"nrf54lm20dk/nrf54lm20b/cpuapp",
			"xiao_nrf54lm20a/nrf54lm20a/cpuapp",
		]
		const roots = [path.join(process.cwd(), "iot-knowledge"), path.join(process.cwd(), "Adsum-Backend", "kbits")]
		const missing: string[] = []
		for (const t of targets) {
			const rel = getBoardKnowledgeFile(t)
			if (!rel) {
				missing.push(`${t} → no route`)
				continue
			}
			if (!roots.some((r) => fs.existsSync(path.join(r, rel)))) {
				missing.push(`${t} → ${rel} (file not found in iot-knowledge/ or Adsum-Backend/kbits/)`)
			}
		}
		assert.deepEqual(missing, [], `routes pointing at files that do not exist:\n${missing.join("\n")}`)
	})
})
