import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * On-disk store for downloaded tool bundles.
 *
 * Three properties, each of which exists because its absence is a real failure:
 *
 *  - **Hash-verified on write AND on read.** Verifying only at download means a later corruption —
 *    or an edit — is executed silently. These are executables; the check is cheap and the failure
 *    mode is not.
 *  - **Atomic.** A bundle is staged in a temp directory and renamed into place, so a process killed
 *    mid-write leaves either nothing or a complete version, never a half-materialised tool the
 *    resolver would then advertise.
 *  - **All-or-nothing.** If any member fails, nothing is published. A bundle missing one file is a
 *    tool that launches and then breaks in the middle of a capture.
 *
 * Layout: <root>/<safe-id>/<version>/<member paths…>. Version directories are kept until a reconcile
 * pass, so a running task never has the tool it is using deleted underneath it.
 */

export const bytesHash = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex")

/** Bit ids contain "/" — flatten to one path segment, reversibly enough for diagnostics. */
export function safeSegment(id: string): string {
	return id.replace(/[^A-Za-z0-9._-]+/g, "_")
}

export interface CacheMember {
	path: string
	sha256: string
}

export class ToolCache {
	constructor(private readonly root: string) {}

	dirFor(id: string, version: string): string {
		return path.join(this.root, safeSegment(id), version)
	}

	/** True when every declared member is present AND its bytes still hash correctly. */
	verify(id: string, version: string, members: CacheMember[]): boolean {
		const dir = this.dirFor(id, version)
		if (!existsSync(dir) || members.length === 0) {
			return false
		}
		for (const m of members) {
			const f = path.join(dir, m.path)
			if (!existsSync(f)) {
				return false
			}
			try {
				if (bytesHash(readFileSync(f)) !== m.sha256) {
					return false
				}
			} catch {
				return false
			}
		}
		return true
	}

	/**
	 * Write a complete bundle. Every member is hash-checked before anything is published; the whole
	 * version directory then appears in one rename. Returns false if any member failed, having left
	 * no trace.
	 */
	materialise(id: string, version: string, files: Array<{ path: string; bytes: Buffer; sha256: string }>): boolean {
		if (files.length === 0) {
			return false
		}
		const finalDir = this.dirFor(id, version)
		// Same parent as the destination so the rename is atomic (a cross-device rename is not).
		const staging = `${finalDir}.staging-${process.pid}-${Date.now()}`
		try {
			for (const f of files) {
				if (bytesHash(f.bytes) !== f.sha256) {
					throw new Error(`hash mismatch for ${f.path}`)
				}
				// Defence in depth: the server validates member paths, but this writes to disk, so it
				// re-checks rather than trusting a response.
				const dest = path.resolve(staging, f.path)
				if (!dest.startsWith(path.resolve(staging) + path.sep)) {
					throw new Error(`illegal member path ${f.path}`)
				}
				mkdirSync(path.dirname(dest), { recursive: true })
				writeFileSync(dest, f.bytes, { mode: 0o755 })
			}
			mkdirSync(path.dirname(finalDir), { recursive: true })
			if (existsSync(finalDir)) {
				rmSync(finalDir, { recursive: true, force: true })
			}
			renameSync(staging, finalDir)
			return true
		} catch {
			rmSync(staging, { recursive: true, force: true })
			return false
		}
	}

	/**
	 * Drop version directories that are no longer live. Called at activation only: doing it mid-task
	 * could remove a tool a running command is executing.
	 */
	reconcile(live: Array<{ id: string; version: string }>): string[] {
		if (!existsSync(this.root)) {
			return []
		}
		const keep = new Set(live.map((l) => `${safeSegment(l.id)}/${l.version}`))
		const removed: string[] = []
		for (const idDir of readdirSync(this.root, { withFileTypes: true })) {
			if (!idDir.isDirectory()) {
				continue
			}
			const idPath = path.join(this.root, idDir.name)
			for (const verDir of readdirSync(idPath, { withFileTypes: true })) {
				if (!verDir.isDirectory()) {
					continue
				}
				// Abandoned staging directories from a killed process are always collectable.
				const isStaging = verDir.name.includes(".staging-")
				if (isStaging || !keep.has(`${idDir.name}/${verDir.name}`)) {
					rmSync(path.join(idPath, verDir.name), { recursive: true, force: true })
					removed.push(`${idDir.name}/${verDir.name}`)
				}
			}
		}
		return removed
	}
}
