import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

/** sha256 of a bit body — matches the manifest `content_hash` (same as gen-kbit-manifest). */
export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex")

/**
 * BitCache — the on-machine cache for **downloaded** K-bits, under `<globalStorage>/kbit-cache/`.
 *
 * Blobs are **content-addressed** (`blobs/<sha256>.md`, immutable) and integrity is verified on
 * **both write and read** — a tampered/corrupt blob is never written or returned. The last-fetched
 * registry catalog (id → content_hash) lives at `manifest.json`. Pure FS; the root is injected so
 * it's unit-testable against a temp dir. Per the validated design, **expiry = revalidate, not delete**
 * (this layer only stores/serves; eviction/revocation is a later increment).
 */
export class BitCache {
	constructor(private readonly root: string) {}

	private blobPath(hash: string): string {
		return path.join(this.root, "blobs", `${hash}.md`)
	}
	private manifestPath(): string {
		return path.join(this.root, "manifest.json")
	}

	/** Cached blob body iff present AND it hashes to `hash`; else null (missing or corrupt → null). */
	async readBlob(hash: string): Promise<string | null> {
		try {
			const body = await fs.readFile(this.blobPath(hash), "utf8")
			return sha256(body) === hash ? body : null
		} catch {
			return null
		}
	}

	/** Persist a blob only if its content matches `hash` (refuse to cache tampered content). */
	async writeBlob(hash: string, body: string): Promise<boolean> {
		if (sha256(body) !== hash) {
			return false
		}
		try {
			await fs.mkdir(path.dirname(this.blobPath(hash)), { recursive: true })
			await fs.writeFile(this.blobPath(hash), body, "utf8")
			return true
		} catch {
			return false
		}
	}

	async readManifest(): Promise<string | null> {
		try {
			return await fs.readFile(this.manifestPath(), "utf8")
		} catch {
			return null
		}
	}

	async writeManifest(json: string): Promise<void> {
		try {
			await fs.mkdir(this.root, { recursive: true })
			await fs.writeFile(this.manifestPath(), json, "utf8")
		} catch {
			// best-effort cache write; a failure just means we re-fetch next time
		}
	}

	/** sha256 hashes of every cached blob (the blob filenames, minus `.md`). */
	async listBlobHashes(): Promise<string[]> {
		try {
			const files = await fs.readdir(path.join(this.root, "blobs"))
			return files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
		} catch {
			return [] // no blobs dir yet
		}
	}

	/** Best-effort delete of a cached blob (used to honor revocation / drop superseded versions). */
	async deleteBlob(hash: string): Promise<void> {
		try {
			await fs.rm(this.blobPath(hash))
		} catch {
			// already gone — fine
		}
	}
}
