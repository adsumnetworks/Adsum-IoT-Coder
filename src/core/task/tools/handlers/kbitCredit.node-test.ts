import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { creditFromMeta } from "@/services/knowledge/kbit/credit"
import { creditBitOnce, type NearMissDeps, serveNearMissBit } from "./kbitCredit"

/**
 * Run: npm run test:kbit-credit
 *
 * 14 September, run k10-blg20x-nrf91-two-probes-one-reset: the agent asked for
 * products/fanstel/blg20x/nrf/actions/two-probes-one-reset-net.md, the read tool served the one bit with
 * that filename "path auto-corrected … served below", and no credit line was ever said for it.
 */
const ID = "adsum/nrf/actions/two-probes-one-reset-net"
const REL = "platforms/nrf/actions/two-probes-one-reset-net.md"
const credit = creditFromMeta({
	id: ID,
	title: "two probes, one reset net",
	author: "Ismail Hamdad",
	version: "0.1.4",
	type: "knowledge",
} as never)

function sink() {
	const said: Array<{ type: string; text: string }> = []
	return {
		said,
		config: {
			taskState: { creditedKbits: new Set<string>() },
			callbacks: { say: async (type: "kbit_loaded", text: string) => void said.push({ type, text }) },
		},
	}
}
const deps = (over: Partial<NearMissDeps> = {}): NearMissDeps => ({
	loadBitByRel: async () => "# Action: two probes\nbody",
	idForRel: () => ID,
	creditFor: () => credit,
	provenanceOf: () => "downloaded",
	markLoaded: () => {},
	track: async () => {},
	...over,
})

describe("a bit served through the path auto-correction is credited, once", () => {
	test("the auto-corrected bit is served and credited", async () => {
		const { said, config } = sink()
		const out = await serveNearMissBit(config, "products/fanstel/blg20x/nrf/actions/two-probes-one-reset-net.md", REL, deps())
		assert.match(out ?? "", /path auto-corrected[\s\S]*# Action: two probes/)
		assert.equal(said.length, 1)
		assert.equal(said[0].type, "kbit_loaded")
		assert.equal(JSON.parse(said[0].text).id, ID)
	})

	test("served twice — by the auto-correction and then by its right path — it is credited once", async () => {
		const { said, config } = sink()
		await serveNearMissBit(config, "products/x/nrf/actions/two-probes-one-reset-net.md", REL, deps())
		await serveNearMissBit(config, "products/y/nrf/actions/two-probes-one-reset-net.md", REL, deps())
		await creditBitOnce(config, credit, "downloaded") // the ordinary serving path
		assert.equal(said.length, 1)
	})

	test("a corrected bit that will not load is not credited and not served", async () => {
		const { said, config } = sink()
		const out = await serveNearMissBit(config, "a/b.md", REL, deps({ loadBitByRel: async () => null }))
		assert.equal(out, null)
		assert.equal(said.length, 0)
	})

	test("no credit facts, no invented credit", async () => {
		const { said, config } = sink()
		assert.equal(await creditBitOnce(config, null, "bundled"), false)
		assert.equal(said.length, 0)
	})
})
