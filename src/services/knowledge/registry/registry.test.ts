import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { __resetManifestCache, __setRegistryHooks, loadBit } from "../KnowledgeResolver"
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
		const manifest = { manifestVersion: 1, bits: [{ id: "adsum/community/x", version: "1.0.0", content_hash: hash }] }
		const rc = new RegistryClient("http://r", stubFetch(manifest, { [hash]: content }))
		__setRegistryHooks({ cache: new BitCache(root), registry: rc })

		assert.equal(await loadBit("adsum/community/x"), "# X (x.md)\nhello") // frontmatter stripped
		assert.equal(await new BitCache(root).readBlob(hash), content) // now cached
		__resetManifestCache()
	})

	test("cache hit serves the bit without any network call", async () => {
		const root = await tmp()
		const { content, hash } = bit("adsum/community/x", "# X (x.md)\nhi")
		const c = new BitCache(root)
		await c.writeBlob(hash, content)
		await c.writeManifest(
			JSON.stringify({ manifestVersion: 1, bits: [{ id: "adsum/community/x", version: "1.0.0", content_hash: hash }] }),
		)
		let calls = 0
		const rc = new RegistryClient("http://r", async () => {
			calls++
			throw new Error("should not fetch")
		})
		__setRegistryHooks({ cache: c, registry: rc })

		assert.equal(await loadBit("adsum/community/x"), "# X (x.md)\nhi")
		assert.equal(calls, 0)
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
})
