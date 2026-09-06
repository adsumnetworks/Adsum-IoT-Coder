/**
 * X-09…X-12 — what happens to bytes already on disk when a grant goes away.
 *
 * The gate the registry enforces is worth nothing if a revoked bit keeps working from the cache, and
 * it is worth less than nothing if an external agent can read it out of a handover. These cases pin
 * the two mechanisms that stop both, and the one property that makes them cheap: the manifest is the
 * authority, so a revoked bit disappears from it and the reconcile purges the blob as a consequence.
 *
 * Run: npm run test:entitlement-cache
 */
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, test } from "node:test"

const REPO = path.resolve(__dirname, "..", "..", "..")
const MCP = path.join(REPO, "mcp", "adsum-mcp.mjs")

describe("X — a revoked grant and the bytes already on disk", () => {
	test("X-09 the reconcile purges exactly what the new manifest no longer lists", async () => {
		const { BitCache, sha256 } = await import("./registry/BitCache")
		const resolver = await import("./KnowledgeResolver")
		const dir = mkdtempSync(path.join(tmpdir(), "adsum-cache-"))
		const cache = new BitCache(dir)

		const freeBody = "the free body"
		const gatedBody = "the gated body"
		const free = sha256(freeBody)
		const gated = sha256(gatedBody)
		assert.equal(await cache.writeBlob(free, freeBody), true)
		assert.equal(await cache.writeBlob(gated, gatedBody), true)

		// The manifest the registry serves once the grant is gone: the gated bit is simply not in it.
		const afterRevoke = {
			bits: [{ id: "adsum/nrf/free-bit", content_hash: free, version: "1.0.0" }],
		}
		let fetched = 0
		resolver.__setRegistryHooks({
			cache,
			registry: {
				fetchManifest: async () => {
					fetched++
					return afterRevoke
				},
			} as never,
		})
		resolver.invalidateForAccountChange()
		await resolver.downloadedEntries()

		assert.equal(fetched, 1, "a change of account revalidates rather than trusting the memo")
		assert.ok(await cache.readBlob(free), "a bit still in the catalog is untouched")
		assert.equal(await cache.readBlob(gated), null, "the revoked bit's body is gone from disk")

		resolver.__resetManifestCache()
		rmSync(dir, { recursive: true, force: true })
	})

	test("X-09b invalidation is what makes it happen at all — without it a warm session keeps the body", async () => {
		const { BitCache } = await import("./registry/BitCache")
		const resolver = await import("./KnowledgeResolver")
		const dir = mkdtempSync(path.join(tmpdir(), "adsum-cache-"))
		let fetched = 0
		// A real cache directory, because the resolver reaches for one and the host is not up in a unit
		// test — an injected cache is what keeps this a unit test rather than an integration one.
		resolver.__setRegistryHooks({
			cache: new BitCache(dir),
			registry: {
				fetchManifest: async () => {
					fetched++
					return { bits: [] }
				},
			} as never,
		})
		// Two resolves in one session hit the network once: that is the memo doing its job, and exactly
		// why a grant change has to drop it explicitly.
		await resolver.downloadedEntries()
		await resolver.downloadedEntries()
		assert.equal(fetched, 1)
		resolver.invalidateForAccountChange()
		await resolver.downloadedEntries()
		assert.equal(fetched, 2, "the account changed, so the catalog is asked for again")
		resolver.__resetManifestCache()
		rmSync(dir, { recursive: true, force: true })
	})

	test("X-10 the MCP server serves a gated bit's absence honestly, and never reaches the network", () => {
		// The invariant first: this file may not import a network client. It is the reason the external
		// agent path inherits the gate instead of needing one of its own.
		const src = readFileSync(MCP, "utf8")
		assert.ok(!/\bfrom\s+["']node:https?["']/.test(src), "no http/https import")
		assert.ok(!/\brequire\(["']node:?https?["']\)/.test(src), "no http/https require")
		assert.ok(!/\bfetch\s*\(/.test(src), "no fetch call")

		const handoverDir = mkdtempSync(path.join(tmpdir(), "adsum-handover-"))
		const id = "qax-gated"
		mkdirSync(path.join(handoverDir, id), { recursive: true })
		// The brief an entitlement-gated handover produces: the bit is KNOWN, and has no body, because
		// the registry refused it when the closure was pinned.
		writeFileSync(
			path.join(handoverDir, id, "brief.json"),
			JSON.stringify({
				mission: "bring up LTE-M",
				bits: [
					{
						id: "adsum/nrf/protocols/lte-attach",
						title: "nRF91 LTE attach & APN recipes",
						author: "Omar El Sayed",
						body: "",
					},
				],
				index: [],
			}),
		)

		const out = mcpCall(handoverDir, "load_bit", { query: "adsum/nrf/protocols/lte-attach" })
		assert.match(out, /entitlement-gated|not cached/i, "says why, rather than inventing a body")
		assert.ok(!/APN/.test(out.replace(/APN recipes/g, "")), "no body content leaks through the title")
		// Credit survives the lock: the author is named on a bit nobody can read.
		assert.match(out, /Omar El Sayed/)

		rmSync(handoverDir, { recursive: true, force: true })
	})

	test("X-11 an entitled handover serves the body, with its credit line", () => {
		const handoverDir = mkdtempSync(path.join(tmpdir(), "adsum-handover-"))
		const id = "qax-entitled"
		mkdirSync(path.join(handoverDir, id), { recursive: true })
		writeFileSync(
			path.join(handoverDir, id, "brief.json"),
			JSON.stringify({
				mission: "bring up LTE-M",
				bits: [
					{
						id: "adsum/nrf/protocols/lte-attach",
						title: "nRF91 LTE attach & APN recipes",
						author: "Omar El Sayed",
						body: "Set the APN before the attach, not after.",
					},
				],
				index: [],
			}),
		)
		const out = mcpCall(handoverDir, "load_bit", { query: "lte-attach" })
		assert.match(out, /Set the APN before the attach, not after\./)
		assert.match(out, /Omar El Sayed/)
		rmSync(handoverDir, { recursive: true, force: true })
	})
})

/** One JSON-RPC round trip over stdio — the same thing an external agent does. */
function mcpCall(handoverDir: string, name: string, args: Record<string, unknown>): string {
	assert.ok(existsSync(MCP), "the MCP server is where the tests think it is")
	const req = [
		JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
	].join("\n")
	const r = spawnSync(process.execPath, [MCP, "--handover-dir", handoverDir], {
		input: `${req}\n`,
		encoding: "utf8",
		timeout: 15000,
	})
	const line = r.stdout
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			try {
				return JSON.parse(l)
			} catch {
				return null
			}
		})
		.find((m) => m?.id === 2)
	assert.ok(line, `the server answered the call (stderr: ${r.stderr.slice(0, 400)})`)
	return line.result?.content?.[0]?.text ?? ""
}
