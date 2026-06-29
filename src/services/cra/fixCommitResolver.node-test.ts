/**
 * Tests for the P2 OSV fix-commit resolver (design/30). Pure parse + API-resilient transport (no real network).
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { type FixCommitHttpGet, makeOsvFixCommitResolver, parseOsvFixCommit } from "./fixCommitResolver"

const OSV_WITH_GIT = JSON.stringify({
	id: "CVE-2099-1234",
	affected: [
		{
			package: { ecosystem: "GitHub", name: "x/y" },
			ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1.2.3" }] }],
		},
		{
			ranges: [
				{
					type: "GIT",
					repo: "https://github.com/x/y",
					events: [{ introduced: "0" }, { fixed: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" }],
				},
			],
		},
	],
})

test("parseOsvFixCommit: extracts the GIT-range fixed commit (not the ECOSYSTEM version)", () => {
	assert.equal(parseOsvFixCommit(OSV_WITH_GIT), "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
})
test("parseOsvFixCommit: no GIT range / bad json → undefined (never throws)", () => {
	assert.equal(
		parseOsvFixCommit(JSON.stringify({ affected: [{ ranges: [{ type: "ECOSYSTEM", events: [{ fixed: "1.0" }] }] }] })),
		undefined,
	)
	assert.equal(parseOsvFixCommit("{not json"), undefined)
	assert.equal(parseOsvFixCommit(JSON.stringify({})), undefined)
})

test("resolver: 200 + GIT range → SHA", async () => {
	const get: FixCommitHttpGet = async () => ({ ok: true, status: 200, text: OSV_WITH_GIT })
	assert.equal(await makeOsvFixCommitResolver(get)("CVE-2099-1234"), "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
})
test("API-RESILIENCE: 404 (not in OSV) → undefined (hedge, never a claim)", async () => {
	const get: FixCommitHttpGet = async () => ({ ok: false, status: 404, text: "" })
	assert.equal(await makeOsvFixCommitResolver(get)("CVE-2099-9999"), undefined)
})
test("API-RESILIENCE: a thrown transport error (timeout / network down) → undefined, NEVER throws", async () => {
	const get: FixCommitHttpGet = async () => {
		throw new Error("AbortError: timeout")
	}
	assert.equal(await makeOsvFixCommitResolver(get)("CVE-2099-1234"), undefined)
})
