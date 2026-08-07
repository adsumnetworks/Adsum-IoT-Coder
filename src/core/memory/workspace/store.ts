/**
 * The `.adsum/` persistence layer — every disk touch project memory makes goes through here.
 *
 * Three properties this module is responsible for, each one a defect we are refusing to ship:
 *
 *  1. **FAIL-OPEN, ALWAYS.** Memory is an enhancement. A read-only checkout, a locked file, a
 *     half-written JSON — none of it may throw into a task. Every function here catches, logs once,
 *     and returns a sane default. The one rule: a task never dies because a memory file was odd.
 *
 *  2. **ATOMIC WRITES.** Every file is written to a sibling temp file and renamed over the target.
 *     A crash (or a killed extension host) mid-write can then only lose the NEW content, never
 *     corrupt the old — the failure mode of a plain `writeFile` is a truncated file that reads back
 *     as garbage, which for a memory store means silently forgetting everything.
 *
 *  3. **NEVER CLOBBER THE HUMAN.** The developer is expected to correct PROJECT.md by hand — that is
 *     the reason memory moved into the workspace. Section writes go through the managed-block
 *     mechanics (@utils/managedBlock), which detect a hand edit inside our fence and SKIP the write.
 *
 * Layout is defined by ./paths.ts; shapes and parsers by ./schema.ts. This file adds no schema
 * knowledge of its own beyond wiring the two together.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { type BlockResult, upsertManagedBlock } from "@utils/managedBlock"
import { type AdsumPaths, resolveAdsumPaths } from "./paths"
import {
	type DevicesJson,
	type EnvJson,
	emptyDevices,
	emptyEnv,
	emptySession,
	emptyStatus,
	parseDevices,
	parseEnv,
	parseSession,
	parseStatus,
	type SessionJson,
	type StatusJson,
} from "./schema"

/** What `.adsum/.gitignore` contains. `local/` is per-bench truth (serials, COM ports, toolchain
 *  paths) — committing it guarantees a merge conflict on a teammate's first push and makes the file
 *  lie for every other machine. */
const GITIGNORE_BODY = "local/\n"

/** One log line per distinct failure, never a throw. Prefixed so it is greppable in the ext host log. */
function warn(what: string, err: unknown): void {
	console.warn(`[adsum][memory] ${what}: ${err instanceof Error ? err.message : String(err)}`)
}

/**
 * Paths for a workspace, or undefined when they cannot even be resolved (no folder open AND no host
 * provider — e.g. inside a unit test or during very early activation). Callers treat undefined as
 * "memory unavailable" and carry on.
 */
function pathsFor(cwd: string | undefined): AdsumPaths | undefined {
	try {
		return resolveAdsumPaths(cwd)
	} catch (err) {
		warn("cannot resolve .adsum paths", err)
		return undefined
	}
}

// ── scaffold ─────────────────────────────────────────────────────────────────────

/**
 * Create `.adsum/`, `.adsum/notes/`, `.adsum/local/` and the `.gitignore`, if they are not there.
 *
 * Idempotent and strictly additive: an existing `.gitignore` is left EXACTLY as the developer left it
 * (they may have added entries of their own), and no existing file is ever rewritten. Safe to call on
 * every write and on every task start.
 *
 * Returns the resolved paths, or undefined if the scaffold could not be created at all.
 */
export function ensureAdsumScaffold(cwd: string | undefined): AdsumPaths | undefined {
	const p = pathsFor(cwd)
	if (!p) {
		return undefined
	}
	try {
		fs.mkdirSync(p.notesDir, { recursive: true })
		fs.mkdirSync(p.localDir, { recursive: true })
	} catch (err) {
		warn(`cannot create ${p.dir}`, err)
		return undefined
	}
	try {
		if (!fs.existsSync(p.gitignore)) {
			fs.writeFileSync(p.gitignore, GITIGNORE_BODY, "utf8")
		}
	} catch (err) {
		// A missing .gitignore only means local/ may get committed — annoying, not fatal.
		warn("cannot write .adsum/.gitignore", err)
	}
	return p
}

// ── primitive I/O ────────────────────────────────────────────────────────────────

/** Read a file, or undefined if it is missing/unreadable. Never throws. */
function readTextOr(file: string, what: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf8")
	} catch (err) {
		// ENOENT is the normal "no memory yet" case and is not worth a log line.
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
			warn(`cannot read ${what}`, err)
		}
		return undefined
	}
}

/**
 * Write via temp file + rename, so the target is only ever the OLD complete content or the NEW
 * complete content. `fs.renameSync` replaces an existing file on both Windows (MoveFileEx with
 * REPLACE_EXISTING) and POSIX, and is atomic within a filesystem — which is why the temp file is
 * deliberately a sibling of the target rather than in the OS temp dir (a cross-device rename would
 * silently degrade to copy+unlink, losing the atomicity we are here for).
 *
 * Returns true on success; false — never a throw — on any failure.
 */
export function writeAtomic(file: string, content: string): boolean {
	const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(tmp, content, "utf8")
		fs.renameSync(tmp, file)
		return true
	} catch (err) {
		warn(`cannot write ${path.basename(file)}`, err)
		try {
			fs.rmSync(tmp, { force: true })
		} catch {
			// Best effort — a stray temp file is harmless, and we must not throw from a cleanup.
		}
		return false
	}
}

/** Pretty JSON with a trailing newline: memory is meant to be read and diffed by a human. */
const toJson = (value: unknown): string => JSON.stringify(value, null, 2) + "\n"

/** Read + validate a JSON memory file; a missing, unreadable, or corrupt file degrades to `empty`. */
function readJson<T>(file: string, what: string, parse: (raw: string) => T, empty: () => T): T {
	const raw = readTextOr(file, what)
	// parse* in schema.ts is total (it catches its own JSON errors), so corrupt content lands on the
	// same default as a missing file — memory forgets rather than breaks.
	return raw === undefined ? empty() : parse(raw)
}

/** Ensure the scaffold, then atomically write `value` as JSON. False on any failure. */
function writeJson(cwd: string | undefined, pick: (p: AdsumPaths) => string, value: unknown): boolean {
	// Scaffold first: writing local/devices.json into a directory with no .gitignore would leak this
	// bench's serial numbers into the repo on the very next commit.
	const p = ensureAdsumScaffold(cwd)
	return p ? writeAtomic(pick(p), toJson(value)) : false
}

// ── typed accessors ──────────────────────────────────────────────────────────────

export function readStatus(cwd: string | undefined): StatusJson {
	const p = pathsFor(cwd)
	return p ? readJson(p.statusJson, "status.json", parseStatus, emptyStatus) : emptyStatus()
}

export function writeStatus(cwd: string | undefined, value: StatusJson): boolean {
	return writeJson(cwd, (p) => p.statusJson, value)
}

export function readDevices(cwd: string | undefined): DevicesJson {
	const p = pathsFor(cwd)
	return p ? readJson(p.devicesJson, "devices.json", parseDevices, emptyDevices) : emptyDevices()
}

export function writeDevices(cwd: string | undefined, value: DevicesJson): boolean {
	return writeJson(cwd, (p) => p.devicesJson, value)
}

export function readEnv(cwd: string | undefined): EnvJson {
	const p = pathsFor(cwd)
	return p ? readJson(p.envJson, "env.json", parseEnv, emptyEnv) : emptyEnv()
}

export function writeEnv(cwd: string | undefined, value: EnvJson): boolean {
	return writeJson(cwd, (p) => p.envJson, value)
}

export function readSession(cwd: string | undefined): SessionJson {
	const p = pathsFor(cwd)
	return p ? readJson(p.sessionJson, "session.json", parseSession, emptySession) : emptySession()
}

export function writeSession(cwd: string | undefined, value: SessionJson): boolean {
	return writeJson(cwd, (p) => p.sessionJson, value)
}

// ── markdown ─────────────────────────────────────────────────────────────────────

/** PROJECT.md as it is on disk — "" when there is none yet. Never throws. */
export function readProjectMd(cwd: string | undefined): string {
	const p = pathsFor(cwd)
	return (p && readTextOr(p.projectMd, "PROJECT.md")) || ""
}

/** MAP.md as it is on disk — "" when there is none yet. Never throws. */
export function readMapMd(cwd: string | undefined): string {
	const p = pathsFor(cwd)
	return (p && readTextOr(p.mapMd, "MAP.md")) || ""
}

/** MAP.md is host-generated in full (no human-owned regions), so it is a plain atomic write. */
export function writeMapMd(cwd: string | undefined, content: string): boolean {
	const p = ensureAdsumScaffold(cwd)
	return p ? writeAtomic(p.mapMd, content.endsWith("\n") ? content : content + "\n") : false
}

/**
 * Upsert ONE host-owned section of PROJECT.md, leaving every other section — and everything the
 * developer wrote around them — untouched.
 *
 * `sectionId` scopes the managed block, so PROJECT.md can hold several independently-owned sections
 * in one file. If the developer has edited inside a section's fence, the write is SKIPPED and
 * `"skipped-user-edited"` comes back: their correction outranks our re-derivation, every time.
 *
 * Returns `"failed"` rather than throwing when the file cannot be written at all.
 */
export function writeProjectMdSection(cwd: string | undefined, sectionId: string, body: string): BlockResult | "failed" {
	const p = ensureAdsumScaffold(cwd)
	if (!p) {
		return "failed"
	}
	try {
		return upsertManagedBlock(p.projectMd, body, sectionId)
	} catch (err) {
		warn(`cannot write PROJECT.md section "${sectionId}"`, err)
		return "failed"
	}
}
