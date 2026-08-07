/**
 * One-shot migration: OLD memory store (`globalStorage/iot-memory/<md5(cwd)>/`, written by
 * `IotProjectMemoryManager`) -> NEW memory store (`<workspace>/.adsum/`, see ./paths.ts and
 * ./store.ts).
 *
 * Why this exists: the old store was invisible (outside the repo, keyed by a path hash) and is
 * being replaced by `.adsum/`. Workspaces that already have old-store content should not lose it
 * silently — but we also must not import the untouched starter templates `initialize()` used to
 * write, or every never-used workspace would get three junk notes files.
 *
 * Contract:
 *  - Runs at most once per workspace: `AdsumPaths.migratedSentinel` (`.adsum/.migrated`) is
 *    checked FIRST and short-circuits every subsequent call.
 *  - Never throws into the caller. Memory is an enhancement (see store.ts's file header) and a
 *    migration is doubly so — any failure degrades to "none" and gets logged, never propagated.
 *  - Content is copied verbatim. This module has zero opinion about what project.md / devices.md
 *    / session.md contain; reshaping legacy prose is a job for the model, not a migration script.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { legacyGlobalStorageDir, resolveAdsumPaths } from "./paths"
import { ensureAdsumScaffold, writeAtomic } from "./store"

export type MigrationResult = "migrated" | "skipped" | "none"

interface LegacyFileSpec {
	/** Filename in the old `iot-memory/<hash>/` directory. */
	legacyName: string
	/** Filename this lands under in `.adsum/notes/`. */
	noteName: string
	/**
	 * The exact starter template `IotProjectMemoryManager.initialize()` wrote, verbatim. Content
	 * that still matches this (after trimming trailing whitespace) is the untouched placeholder,
	 * not a real note, and must NOT be imported.
	 */
	placeholder: (cwd: string) => string
}

// Mirrors IotProjectMemoryManager.initialize()'s `filesToInitialize` exactly — see
// src/core/memory/IotProjectMemoryManager.ts. If that template ever changes, this must follow it,
// or old-but-untouched workspaces will start getting "migrated" junk notes.
const LEGACY_FILES: LegacyFileSpec[] = [
	{
		legacyName: "project.md",
		noteName: "legacy-project.md",
		placeholder: (cwd) =>
			`# Workspace: ${path.basename(cwd)}\n\n## Project Context\n\nAdd details about the application logic, dependencies, and overall architecture here.\n`,
	},
	{
		legacyName: "devices.md",
		noteName: "legacy-devices.md",
		placeholder: () =>
			`# Device & Hardware Profiles\n\n## Target Hardware\n\nDocument the board target (e.g., nrf52840dk), pin configurations, and external sensors here.\n`,
	},
	{
		legacyName: "session.md",
		noteName: "legacy-session.md",
		placeholder: () =>
			`# Session Memory\n\n## Current Debugging State\n\nKeep track of the current problem, open issues, and findings from the latest debug loop.\n`,
	},
]

function warn(what: string, err: unknown): void {
	console.warn(`[adsum][memory][migrate] ${what}: ${err instanceof Error ? err.message : String(err)}`)
}

/** Read a file, or undefined if missing/unreadable. Never throws. */
function readTextOr(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf8")
	} catch {
		return undefined
	}
}

/**
 * Migrate legacy `iot-memory/<hash>/` content into `.adsum/notes/`, once, for one workspace.
 *
 * @param cwd Workspace root. `undefined` (no folder open) means there is nothing to migrate
 *   into — returns "none".
 * @param legacyDirOverride Test-only injection point for the legacy directory path.
 *   `legacyGlobalStorageDir(cwd)` goes through `HostProvider.get()`, which is not initialized in
 *   a plain test process; production callers never pass this and get the real resolution.
 */
export function migrateLegacyMemory(cwd: string | undefined, legacyDirOverride?: string): MigrationResult {
	try {
		if (!cwd) {
			return "none"
		}

		const adsumPaths = resolveAdsumPaths(cwd)
		if (fs.existsSync(adsumPaths.migratedSentinel)) {
			return "skipped"
		}

		let legacyDir: string
		if (legacyDirOverride !== undefined) {
			legacyDir = legacyDirOverride
		} else {
			try {
				legacyDir = legacyGlobalStorageDir(cwd)
			} catch (err) {
				warn("cannot resolve legacy memory directory", err)
				return "none"
			}
		}

		if (!fs.existsSync(legacyDir)) {
			return "none"
		}

		const toImport: Array<{ legacyName: string; noteName: string; content: string }> = []
		for (const spec of LEGACY_FILES) {
			const raw = readTextOr(path.join(legacyDir, spec.legacyName))
			if (raw === undefined) {
				continue
			}
			if (raw.trim() === spec.placeholder(cwd).trim()) {
				// Untouched starter template — not a real note.
				continue
			}
			toImport.push({ legacyName: spec.legacyName, noteName: spec.noteName, content: raw })
		}

		if (toImport.length === 0) {
			return "none"
		}

		const p = ensureAdsumScaffold(cwd)
		if (!p) {
			return "none"
		}

		const importedAt = new Date().toISOString()
		for (const { legacyName, noteName, content } of toImport) {
			const header = `<!-- Imported automatically from the legacy memory store (${path.join(legacyDir, legacyName)}) on ${importedAt}. Content preserved verbatim below. -->\n\n`
			const ok = writeAtomic(path.join(p.notesDir, noteName), header + content)
			if (!ok) {
				warn(`failed to write ${noteName}`, undefined)
			}
		}

		if (!writeAtomic(p.migratedSentinel, `migrated ${importedAt}\n`)) {
			// Sentinel failed to write: better to have imported notes and re-attempt (idempotent —
			// unchanged legacy content just re-copies) than to silently pretend this never ran.
			warn("failed to write migration sentinel", undefined)
		}

		return "migrated"
	} catch (err) {
		warn("migration failed", err)
		return "none"
	}
}
