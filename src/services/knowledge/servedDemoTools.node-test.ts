/**
 * D-01…D-03 — which demo pairs the registry serves this account, as the panel is told.
 *
 * [14 Sep 2026] The LEW840x demo pair was withdrawn from the registry while the welcome card still offered
 * it to every registered account. The card now asks the host which demo-pair tools the manifest serves; these
 * pin the three answers that matters to the card: unknown before the manifest is read, the served ids after,
 * and a withdrawn pair absent from them.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/knowledge/servedDemoTools.node-test.ts
 */
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, test } from "node:test"

describe("D — the demo pairs the registry serves", () => {
	test("D-01 before the manifest is read the answer is unknown, and reading it does not need a task", async () => {
		const { BitCache } = await import("./registry/BitCache")
		const { ALL_DEMO_PAIR_TOOLS, demoPairServed } = await import("../../shared/adsumDemoPairs")
		const resolver = await import("./KnowledgeResolver")
		const dir = mkdtempSync(path.join(tmpdir(), "adsum-demo-"))
		resolver.__resetManifestCache()
		resolver.__setRegistryHooks({
			cache: new BitCache(dir),
			registry: {
				// As on 14 Sep 2026: the BLG20x pair is served, the LEW840x pair was withdrawn and is not listed.
				fetchManifest: async () => ({
					bits: [
						{ id: "adsum/tools/blg20-hex-demo-pair", content_hash: "a".repeat(64), version: "0.1.6" },
						{ id: "adsum/nrf/some-bit", content_hash: "b".repeat(64), version: "1.0.0" },
					],
				}),
			} as never,
		})

		const before = resolver.servedIdsSnapshot(ALL_DEMO_PAIR_TOOLS)
		assert.equal(before.known, false, "nothing has read the manifest yet")
		assert.equal(demoPairServed(undefined, "lew840x-demo-hex"), true, "unknown hides nothing")

		await resolver.warmDownloadedManifest()
		const after = resolver.servedIdsSnapshot(ALL_DEMO_PAIR_TOOLS)
		assert.equal(after.known, true)
		assert.deepEqual(after.served, ["adsum/tools/blg20-hex-demo-pair"], "only the demo-pair tools the manifest lists")

		assert.equal(demoPairServed(after.served, "blg20-demo-hex"), true, "the served pair is offered")
		assert.equal(demoPairServed(after.served, "lew840x-demo-hex"), false, "the withdrawn pair is not")

		resolver.__resetManifestCache()
		rmSync(dir, { recursive: true, force: true })
	})

	test("D-02 a change of account makes the answer unknown again, so a revoked pair is not kept on the card", async () => {
		const { BitCache } = await import("./registry/BitCache")
		const { ALL_DEMO_PAIR_TOOLS } = await import("../../shared/adsumDemoPairs")
		const resolver = await import("./KnowledgeResolver")
		const dir = mkdtempSync(path.join(tmpdir(), "adsum-demo-"))
		resolver.__resetManifestCache()
		resolver.__setRegistryHooks({
			cache: new BitCache(dir),
			registry: { fetchManifest: async () => ({ bits: [] }) } as never,
		})
		await resolver.warmDownloadedManifest()
		assert.equal(resolver.servedIdsSnapshot(ALL_DEMO_PAIR_TOOLS).known, true)
		resolver.invalidateForAccountChange()
		assert.equal(resolver.servedIdsSnapshot(ALL_DEMO_PAIR_TOOLS).known, false)
		resolver.__resetManifestCache()
		rmSync(dir, { recursive: true, force: true })
	})

	test("D-03 a pair needs every one of its tools: half a pair is not a demo", async () => {
		const { demoPairServed } = await import("../../shared/adsumDemoPairs")
		assert.equal(demoPairServed(["adsum/tools/lew840x-hex-lte-demo"], "lew840x-demo-hex"), false)
		assert.equal(
			demoPairServed(["adsum/tools/lew840x-hex-lte-demo", "adsum/tools/lew840x-hex-esp32-lte"], "lew840x-demo-hex"),
			true,
		)
	})
})
