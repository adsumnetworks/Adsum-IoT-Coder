import { promises as fsp } from "node:fs"
import path from "node:path"
import { gunzipSync } from "node:zlib"

/**
 * Unpack a .tar.gz into `dest`, in Node, the same on every system. A system `tar` differs too much to rely on: on
 * Windows the first `tar` on PATH may be Git's, which reads `E:\...` as a host name (found 11 Oct 2026).
 *
 * Handles what python-build-standalone archives hold: plain files with their mode, folders, symbolic links (macOS and
 * Linux), hard links, and the long-name records of both the pax and the GNU formats. A name that would land outside
 * `dest` (an absolute path or `..`) stops the unpacking.
 */

const BLOCK = 512

function cString(buf: Buffer, at: number, len: number): string {
	const s = buf.subarray(at, at + len)
	const end = s.indexOf(0)
	return s.subarray(0, end < 0 ? len : end).toString("utf8")
}

function octal(buf: Buffer, at: number, len: number): number {
	if (buf[at] & 0x80) {
		// base-256, for sizes over 8 GB; read the low 6 bytes, more than any archive here needs
		let n = 0
		for (let i = Math.max(at + 1, at + len - 6); i < at + len; i++) n = n * 256 + buf[i]
		return n
	}
	const s = cString(buf, at, len).trim()
	return s ? Number.parseInt(s, 8) : 0
}

function paxRecords(body: Buffer): Record<string, string> {
	const out: Record<string, string> = {}
	let off = 0
	while (off < body.length) {
		const space = body.indexOf(0x20, off)
		if (space < 0) break
		const len = Number.parseInt(body.subarray(off, space).toString("utf8"), 10)
		if (!Number.isFinite(len) || len <= 0) break
		const rec = body.subarray(space + 1, off + len - 1).toString("utf8") // drop the trailing newline
		const eq = rec.indexOf("=")
		if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
		off += len
	}
	return out
}

/** `dest` joined with an archive name, or an error if the name would leave `dest`. Exported for the tests. */
export function safeJoin(dest: string, name: string): string {
	const clean = name.replace(/\\/g, "/").replace(/^(\.\/)+/, "")
	if (!clean || clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.split("/").includes("..")) {
		throw new Error(`unsafe name in the archive: ${name}`)
	}
	return path.join(dest, ...clean.split("/").filter(Boolean))
}

export interface ExtractStats {
	files: number
	dirs: number
	links: number
}

/** Unpack a tar archive held in memory. Exported for the tests. */
export async function extractTar(
	data: Buffer,
	dest: string,
	platform: NodeJS.Platform = process.platform,
): Promise<ExtractStats> {
	const stats: ExtractStats = { files: 0, dirs: 0, links: 0 }
	const made = new Set<string>()
	const mkdir = async (d: string) => {
		if (made.has(d)) return
		await fsp.mkdir(d, { recursive: true })
		made.add(d)
	}
	const hardLinks: Array<{ from: string; to: string }> = []
	let pax: Record<string, string> = {}
	let longName: string | undefined
	let longLink: string | undefined
	let off = 0
	await mkdir(dest)
	while (off + BLOCK <= data.length) {
		const h = data.subarray(off, off + BLOCK)
		if (h.every((b) => b === 0)) break
		const flag = h[156] === 0 ? "0" : String.fromCharCode(h[156])
		const size = pax.size !== undefined ? Number(pax.size) : octal(h, 124, 12)
		const body = data.subarray(off + BLOCK, off + BLOCK + size)
		off += BLOCK + Math.ceil(size / BLOCK) * BLOCK
		if (flag === "x") {
			pax = paxRecords(body)
			continue
		}
		if (flag === "g") continue
		if (flag === "L") {
			longName = cString(body, 0, body.length)
			continue
		}
		if (flag === "K") {
			longLink = cString(body, 0, body.length)
			continue
		}
		const ustar = cString(h, 257, 6) === "ustar"
		const prefix = ustar ? cString(h, 345, 155) : ""
		const base = cString(h, 0, 100)
		const name = pax.path ?? longName ?? (prefix ? `${prefix}/${base}` : base)
		const linkName = pax.linkpath ?? longLink ?? cString(h, 157, 100)
		const mode = octal(h, 100, 8)
		pax = {}
		longName = undefined
		longLink = undefined
		const target = safeJoin(dest, name)
		if (flag === "5") {
			await mkdir(target)
			stats.dirs++
		} else if (flag === "0" || flag === "7") {
			await mkdir(path.dirname(target))
			await fsp.writeFile(target, body)
			if (platform !== "win32" && mode) await fsp.chmod(target, mode & 0o777)
			stats.files++
		} else if (flag === "2") {
			if (platform === "win32") continue // no symbolic link in the Windows archives; a link would need rights
			// A link must stay inside the archive, or a later file written through it could land anywhere.
			if (path.posix.isAbsolute(linkName)) throw new Error(`unsafe link in the archive: ${name} -> ${linkName}`)
			safeJoin(dest, path.posix.normalize(path.posix.join(path.posix.dirname(name.replace(/\\/g, "/")), linkName)))
			await mkdir(path.dirname(target))
			await fsp.rm(target, { force: true })
			await fsp.symlink(linkName, target)
			stats.links++
		} else if (flag === "1") {
			hardLinks.push({ from: safeJoin(dest, linkName), to: target })
		}
		// character and block devices, FIFOs: nothing a Python needs
	}
	for (const l of hardLinks) {
		await mkdir(path.dirname(l.to))
		await fsp.copyFile(l.from, l.to)
		const st = await fsp.stat(l.from)
		if (platform !== "win32") await fsp.chmod(l.to, st.mode & 0o777)
		stats.links++
	}
	return stats
}

/** Unpack a .tar.gz file into `dest`. */
export async function extractTarGz(
	file: string,
	dest: string,
	platform: NodeJS.Platform = process.platform,
): Promise<ExtractStats> {
	return extractTar(gunzipSync(await fsp.readFile(file)), dest, platform)
}
