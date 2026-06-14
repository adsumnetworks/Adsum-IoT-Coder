import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { __resetManifestCache, __setRegistryHooks, isRegistryReachable, loadBit, loadBitByKbPath } from "../KnowledgeResolver"
import { BitCache, sha256 } from "./BitCache"
import { RegistryClient } from "./RegistryClient"

const tmp = () => mkdtemp(join(tmpdir(), "kbit-cache-"))

/** A stub `fetch` that serves a manifest at /v1/kbits/manifest and blobs at /v1/kbits/blob/<hash>. */
const stubFetch =
	(manifest: unknown, blobs: Record<string, string>, onCall?: () => void) =>
	async (url: string): Promise<Response> => {
		onCall?.()
		if (url.endsWith("/v1/kbits/manifest")) {
			return new Response(JSON.stringify(manifest), { status: 200 })
		}
		const m = url.match(/\/v1\/kbits\/blob\/(.+)$/)
		const hash = m ? decodeURIComponent(m[1]) : ""
		return hash in blobs ? new Response(blobs[hash], { status: 200 }) : new Response("nf", { status: 404 })
	}

const bit = (id: string, body: string) => {
	const content = `---\nid: ${id}\n---\n\n${body}`
	return { content, hash: sha256(content) }
}

// ---------------------------------------------------------------- BitCache

describe("BitCache", () => {
	test("write/read round-trip for a content-addressed blob", async () => {
		const c = new BitCache(await tmp())
		const body = "hello bit"
		const hash = sha256(body)
		assert.equal(await c.writeBlob(hash, body), true)
		assert.equal(await c.readBlob(hash), body)
	})

	test("refuses to write a blob whose content does not match the hash", async () => {
		const c = new BitCache(await tmp())
		assert.equal(await c.writeBlob(sha256("real"), "tampered"), false)
		assert.equal(await c.readBlob(sha256("real")), null)
	})

	test("readBlob returns null for a corrupt cached file (hash mismatch on disk)", async () => {
		const root = await tmp()
		const c = new BitCache(root)
		const hash = sha256("real")
		await mkdir(join(root, "blobs"), { recursive: true })
		await writeFile(join(root, "blobs", `${hash}.md`), "corrupted", "utf8") // bypass writeBlob
		assert.equal(await c.readBlob(hash), null)
	})

	test("manifest round-trip", async () => {
		const c = new BitCache(await tmp())
		await c.writeManifest('{"manifestVersion":1,"bits":[]}')
		assert.equal(await c.readManifest(), '{"manifestVersion":1,"bits":[]}')
	})

	test("listBlobHashes + deleteBlob", async () => {
		const c = new BitCache(await tmp())
		const h = sha256("blob-a")
		assert.deepEqual(await c.listBlobHashes(), []) // none yet
		await c.writeBlob(h, "blob-a")
		assert.deepEqual(await c.listBlobHashes(), [h])
		await c.deleteBlob(h)
		assert.equal(await c.readBlob(h), null)
		assert.deepEqual(await c.listBlobHashes(), [])
	})
})

// ---------------------------------------------------------------- RegistryClient

describe("RegistryClient", () => {
	test("fetchManifest parses valid JSON; fetchBlob returns the body", async () => {
		const { content, hash } = bit("adsum/community/x", "# X")
		const manifest = { manifestVersion: 1, bits: [{ id: "adsum/community/x", version: "1.0.0", content_hash: hash }] }
		const rc = new RegistryClient("http://r", stubFetch(manifest, { [hash]: content }))
		assert.deepEqual((await rc.fetchManifest())?.bits[0].id, "adsum/community/x")
		assert.equal(await rc.fetchBlob(hash), content)
	})

	test("offline-safe: network throw → null; 404 → null; malformed manifest → null", async () => {
		const throwing = new RegistryClient("http://r", async () => {
			throw new Error("offline")
		})
		assert.equal(await throwing.fetchManifest(), null)
		assert.equal(await throwing.fetchBlob("abc"), null)
		const bad = new RegistryClient("http://r", async () => new Response("not json", { status: 200 }))
		assert.equal(await bad.fetchManifest(), null)
	})
})

// ---------------------------------------------------------------- resolver downloaded tier

describe("KnowledgeResolver downloaded tier (bundled→cache→fetch)", () => {
	test("fetch → verify → cache → strip frontmatter", async () => {
		const root = await tmp()
		const { content, hash } = bit("adsum/community/x", "# X (x.md)\nhello")
		// open license → eligible for on-disk plaintext caching (proprietary bits are covered separately below)
		const manifest = {
			manifestVersion: 1,
			bits: [{ id: "adsum/community/x", version: "1.0.0", content_hash: hash, license: "CC-BY-SA-4.0" }],
		}
		const rc = new RegistryClient("http://r", stubFetch(manifest, { [hash]: content }))
		__setRegistryHooks({ cache: new BitCache(root), registry: rc })

		assert.equal(await loadBit("adsum/community/x"), "# X (x.md)\nhello") // frontmatter stripped
		assert.equal(await new BitCache(root).readBlob(hash), content) // now cached
		__resetManifestCache()
	})

	test("registry down → still serves a cached bit from the cached catalog (offline-resilient)", async () => {
		const root = await tmp()
		const { content, hash } = bit("adsum/community/x", "# X (x.md)\nhi")
		const c = new BitCache(root)
		await c.writeBlob(hash, content)
		await c.writeManifest(
			JSON.stringify({ manifestVersion: 1, bits: [{ id: "adsum/community/x", version: "1.0.0", content_hash: hash }] }),
		)
		const rc = new RegistryClient("http://r", async () => {
			throw new Error("offline")
		})
		__setRegistryHooks({ cache: c, registry: rc })

		// revalidation fetch fails → falls back to the cached catalog + cached blob (no throw)
		assert.equal(await loadBit("adsum/community/x"), "# X (x.md)\nhi")
		__resetManifestCache()
	})

	test("tampered blob (hash mismatch) is rejected and not cached", async () => {
		const root = await tmp()
		const hash = sha256("the real bit")
		const manifest = { manifestVersion: 1, bits: [{ id: "adsum/community/x", version: "1.0.0", content_hash: hash }] }
		const rc = new RegistryClient("http://r", stubFetch(manifest, { [hash]: "TAMPERED" }))
		__setRegistryHooks({ cache: new BitCache(root), registry: rc })

		assert.equal(await loadBit("adsum/community/x"), "")
		assert.equal(await new BitCache(root).readBlob(hash), null)
		__resetManifestCache()
	})

	test("offline + empty cache → '' (never throws)", async () => {
		const rc = new RegistryClient("http://r", async () => {
			throw new Error("offline")
		})
		__setRegistryHooks({ cache: new BitCache(await tmp()), registry: rc })
		assert.equal(await loadBit("adsum/community/x"), "")
		__resetManifestCache()
	})

	test("cache miss revalidates the catalog → sees a newly-published bit", async () => {
		const c = new BitCache(await tmp())
		await c.writeManifest(JSON.stringify({ manifestVersion: 1, bits: [] })) // stale catalog: bit not in it yet
		const { content, hash } = bit("adsum/nrf/workflows/debug-loop", "# Debug Loop")
		const rc = new RegistryClient(
			"http://r",
			stubFetch(
				{ manifestVersion: 1, bits: [{ id: "adsum/nrf/workflows/debug-loop", version: "1.1.0", content_hash: hash }] },
				{ [hash]: content },
			),
		)
		__setRegistryHooks({ cache: c, registry: rc })
		// revalidate-first fetches the current catalog → resolves the newly-published bit
		assert.equal(await loadBit("adsum/nrf/workflows/debug-loop"), "# Debug Loop")
		__resetManifestCache()
	})

	test("revalidation purges a cached blob no longer in the catalog (revocation)", async () => {
		const root = await tmp()
		const c = new BitCache(root)
		const { content, hash } = bit("adsum/community/gone", "# Gone")
		await c.writeBlob(hash, content) // bit was cached
		await c.writeManifest(
			JSON.stringify({ manifestVersion: 1, bits: [{ id: "adsum/community/gone", version: "1.0.0", content_hash: hash }] }),
		)
		const rc = new RegistryClient("http://r", stubFetch({ manifestVersion: 1, bits: [] }, {})) // fresh catalog omits it
		__setRegistryHooks({ cache: c, registry: rc })

		assert.equal(await loadBit("adsum/community/gone"), "") // no longer in the catalog → not served
		assert.equal(await new BitCache(root).readBlob(hash), null) // and its blob was purged
		__resetManifestCache()
	})

	test("revalidation picks up a new version (changed content_hash)", async () => {
		const root = await tmp()
		const c = new BitCache(root)
		const v1 = bit("adsum/community/x", "# X v1")
		const v2 = bit("adsum/community/x", "# X v2")
		await c.writeBlob(v1.hash, v1.content)
		await c.writeManifest(
			JSON.stringify({ manifestVersion: 1, bits: [{ id: "adsum/community/x", version: "1.0.0", content_hash: v1.hash }] }),
		)
		const rc = new RegistryClient(
			"http://r",
			stubFetch(
				{ manifestVersion: 1, bits: [{ id: "adsum/community/x", version: "1.1.0", content_hash: v2.hash }] },
				{ [v2.hash]: v2.content },
			),
		)
		__setRegistryHooks({ cache: c, registry: rc })

		assert.equal(await loadBit("adsum/community/x"), "# X v2") // fresh hash fetched, not stale v1
		assert.equal(await new BitCache(root).readBlob(v1.hash), null) // superseded v1 blob purged
		__resetManifestCache()
	})
})

// ---------------------------------------------------------------- P2.5: read_file → registry fallback

describe("loadBitByKbPath (P2.5 — un-bundled on-demand bits via read_file)", () => {
	const hook = (id: string, content: string, hash: string, root: string) =>
		__setRegistryHooks({
			registry: new RegistryClient(
				"http://r",
				stubFetch({ manifestVersion: 1, bits: [{ id, version: "1.0.0", content_hash: hash }] }, { [hash]: content }),
			),
			cache: new BitCache(root),
		})

	test("maps an iot-knowledge path → id → registry → stripped body", async () => {
		const { content, hash } = bit("adsum/nrf/workflows/test-validate", "# Test & Validate (test-validate.md)")
		hook("adsum/nrf/workflows/test-validate", content, hash, await tmp())
		const body = await loadBitByKbPath("/ext/iot-knowledge/platforms/nrf/workflows/test-validate.md")
		assert.equal(body, "# Test & Validate (test-validate.md)")
		__resetManifestCache()
	})

	test("handles Windows-style separators", async () => {
		const { content, hash } = bit("adsum/nrf/actions/run-twister", "# Run Twister")
		hook("adsum/nrf/actions/run-twister", content, hash, await tmp())
		const body = await loadBitByKbPath("C:\\ext\\iot-knowledge\\platforms\\nrf\\actions\\run-twister.md")
		assert.equal(body, "# Run Twister")
		__resetManifestCache()
	})

	test("non-iot-knowledge path → null (no effect on normal file reads)", async () => {
		assert.equal(await loadBitByKbPath("/home/user/project/src/main.c"), null)
	})

	test("unknown/offline bit → null (read_file then surfaces its normal not-found)", async () => {
		__setRegistryHooks({
			registry: new RegistryClient("http://r", async () => {
				throw new Error("offline")
			}),
			cache: new BitCache(await tmp()),
		})
		assert.equal(await loadBitByKbPath("/ext/iot-knowledge/platforms/nrf/workflows/ghost.md"), null)
		__resetManifestCache()
	})
})

// ---------------------------------------------------------------- proprietary cache policy + reachability

describe("downloaded-bit cache policy (proprietary not plaintext-cached)", () => {
	const serve = (id: string, content: string, hash: string, license: string, root: string) =>
		__setRegistryHooks({
			registry: new RegistryClient(
				"http://r",
				stubFetch(
					{ manifestVersion: 1, bits: [{ id, version: "1.0.0", content_hash: hash, license }] },
					{ [hash]: content },
				),
			),
			cache: new BitCache(root),
		})

	test("OPEN bit is served AND cached as plaintext", async () => {
		const root = await tmp()
		const { content, hash } = bit("adsum/community/open", "# Open")
		serve("adsum/community/open", content, hash, "CC-BY-SA-4.0", root)
		assert.equal(await loadBit("adsum/community/open"), "# Open")
		assert.equal(await new BitCache(root).readBlob(hash), content) // cached
		__resetManifestCache()
	})

	test("PROPRIETARY bit is served but NOT cached on disk (no plaintext at rest)", async () => {
		const root = await tmp()
		const { content, hash } = bit("adsum/partner/secret", "# Secret")
		serve("adsum/partner/secret", content, hash, "LicenseRef-Adsum-Proprietary", root)
		assert.equal(await loadBit("adsum/partner/secret"), "# Secret") // served
		assert.equal(await new BitCache(root).readBlob(hash), null) // NOT cached
		__resetManifestCache()
	})
})

describe("isRegistryReachable", () => {
	test("true when the manifest fetch succeeds", async () => {
		__setRegistryHooks({
			registry: new RegistryClient("http://r", stubFetch({ manifestVersion: 1, bits: [] }, {})),
			cache: new BitCache(await tmp()),
		})
		assert.equal(await isRegistryReachable(), true)
		__resetManifestCache()
	})

	test("false when the registry is unreachable", async () => {
		__setRegistryHooks({
			registry: new RegistryClient("http://r", async () => {
				throw new Error("offline")
			}),
			cache: new BitCache(await tmp()),
		})
		assert.equal(await isRegistryReachable(), false)
		__resetManifestCache()
	})
})
