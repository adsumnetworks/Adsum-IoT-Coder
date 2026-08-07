/**
 * Workspace FILE MAP — a bounded, deterministic walk of the open project.
 *
 * WHY THIS EXISTS (measured, not guessed): across real sessions the agent spent a median ~1.9K and
 * up to 17K tokens per task doing nothing but orientation — list_files, search_files, re-reading the
 * build config to find out where things are. The same file was re-read up to 17 times in one task,
 * and the single most re-read class was the cross-chip contract headers under `shared/`. None of
 * that is reasoning; it is the agent rediscovering a directory tree that does not change.
 *
 * The map is generated once by the host, written to `.adsum/MAP.md`, and injected instead. It is a
 * MAP, never a substitute for reading a file — it carries paths, sizes and a one-word kind, and
 * nothing about contents.
 *
 * THREE PROPERTIES ARE LOAD-BEARING:
 *
 *  1. BYTE-STABLE OUTPUT. The map rides in the cached system-prompt prefix. If two runs over an
 *     unchanged tree produce different bytes, every task pays a full prefix re-process. So: no
 *     locale-sensitive comparison (plain code-unit `<`), no readdir order dependence (everything
 *     sorted), no timestamps in the rendered form.
 *
 *  2. BOUNDED. Depth and total-entry limits, enforced DURING the walk rather than after, so opening
 *     a monorepo or a west workspace does not stat 200K files to then throw them away.
 *
 *  3. HONEST WHEN TRUNCATED. A limit that silently swallows half the tree teaches the agent the map
 *     is complete when it is not, which is worse than no map. Truncation is recorded on the result
 *     (see `MapTruncation`) so the renderer can say so out loud.
 *
 * Deliberately NOT here: ranking, PageRank, import-graph analysis, tree-sitter. A firmware repo is
 * ~46 source files. Ranking that is complexity with no payoff and a well-known source of bugs.
 */

import type { Dirent } from "fs"
import * as fs from "fs/promises"
import ignore, { type Ignore } from "ignore"
import * as path from "path"
import { SKIP_DIRS } from "@/services/platform/WorkspaceClassifier"
import { isAdsumPath } from "./paths"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * What a file IS, decided from its name alone. Enough for the agent to know which file to open
 * first; cheap enough that it costs one string test per entry.
 */
export type MapEntryKind = "entrypoint" | "config" | "overlay" | "header" | "source" | "build-config" | "doc" | "other"

export interface WorkspaceMapEntry {
	/** Repo-relative, ALWAYS forward slashes — the map must be identical on Windows and Linux. */
	path: string
	size: number
	mtimeMs: number
	kind: MapEntryKind
}

/** Why (and how much) the walk stopped short. Absent/`truncated: false` means the map is complete. */
export interface MapTruncation {
	truncated: boolean
	/** Hit the entry cap — files exist that are not listed. */
	countLimited: boolean
	/** Directories at the depth limit that were never descended into (sorted, capped for stability). */
	depthLimited: string[]
	maxDepth: number
	maxEntries: number
}

/**
 * The walk result. It IS a `WorkspaceMapEntry[]` — callers map/filter over it exactly as usual —
 * with the truncation record attached as a non-enumerable property. Metadata about the walk is not
 * an entry in the walk, and inventing a wrapper object would make every call site unwrap something
 * it never needs.
 */
export type WorkspaceMap = WorkspaceMapEntry[] & { truncation: MapTruncation }

export interface BuildWorkspaceMapOptions {
	/** Max path segments deep. `nrf_scanner/src/main.c` is 3. Default 4. */
	maxDepth?: number
	/** Max files recorded. Default 400. */
	maxEntries?: number
	/** Honor `<root>/.gitignore` when present. Default true. */
	useGitignore?: boolean
}

export const DEFAULT_MAX_DEPTH = 4
export const DEFAULT_MAX_ENTRIES = 400

/** How many depth-limited directory names we keep. The renderer only ever prints a count + a few. */
const MAX_DEPTH_LIMITED_RECORDED = 32

// ---------------------------------------------------------------------------
// Skip rules
// ---------------------------------------------------------------------------

/**
 * Skipped in ADDITION to WorkspaceClassifier's SKIP_DIRS (imported, never duplicated — two copies
 * of a skip list drift, and the one that drifts is always the one nobody is looking at).
 *
 * `logs` is here because a captured RTT session is megabytes of text that says nothing about the
 * shape of the project; `.adsum` because the map must not map the memory that contains the map.
 */
const EXTRA_SKIP_DIRS = new Set([
	"build",
	"logs",
	// Singular `log` too: ESP-IDF writes idf_py_stdout_output_* there. Found on a real gateway repo,
	// where the plural-only list let build chatter into the map.
	"log",
	"twister-out",
	"managed_components",
	"node_modules",
	".git",
])

/** Files skipped by exact name — stale generated config that only ever misleads. */
const SKIP_FILES = new Set(["sdkconfig.old"])

/**
 * Extensions that are never worth a map line.
 *
 * Two separate reasons, both found on a real gateway repo:
 *  - BINARY/GENERATED (.bin .elf .hex .map .lock .o .a): bytes the agent can never usefully read.
 *  - KEY MATERIAL (.pem .key .der .p12 .pfx): MAP.md is meant to be committed, and writing the
 *    path of `secure_boot_signing_key.pem` into a committed file is a habit worth not forming.
 *    The map's job is to describe the project's shape, not to index its secrets.
 */
const SKIP_EXTENSIONS = new Set([".bin", ".elf", ".hex", ".map", ".lock", ".o", ".a", ".pem", ".key", ".der", ".p12", ".pfx"])

/**
 * Extensionless files worth keeping. Everything else without an extension is skipped.
 *
 * A real gateway repo contained files literally named `esp` (28 KB), `c` (3.8 KB) and `fix` —
 * debris from mistyped shell redirections. They are real files, so a naive walker lists them, and
 * they then sit in the map forever looking like they mean something.
 */
const KEEP_EXTENSIONLESS = new Set(["Kconfig", "Makefile", "Dockerfile", "LICENSE", "NOTICE", "README", "CODEOWNERS"])

function shouldSkipFile(name: string): boolean {
	if (SKIP_FILES.has(name)) {
		return true
	}
	const dot = name.lastIndexOf(".")
	if (dot <= 0) {
		// No extension (a leading dot means a dotfile like .clangd, which we keep).
		return !KEEP_EXTENSIONLESS.has(name) && !name.startsWith(".") && !name.startsWith("Kconfig")
	}
	return SKIP_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

/**
 * Any `build*` directory, not the literal name "build".
 *
 * This is a REGRESSION GUARD, not a nicety. A real gateway repo builds into `build_nrf_scanner/`;
 * matching the literal name "build" missed it and the map went from 46 files to 251 — five sixths
 * of it CMake scratch. The classifier makes the same `startsWith("build")` call for the same reason.
 */
function isBuildDir(name: string): boolean {
	return name.startsWith("build")
}

function shouldSkipDir(name: string, absPath: string): boolean {
	return SKIP_DIRS.has(name) || EXTRA_SKIP_DIRS.has(name) || isBuildDir(name) || isAdsumPath(absPath)
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const ENTRYPOINT_NAMES = new Set(["main.c", "main.cpp", "app_main.c"])
const CONFIG_NAMES = new Set(["prj.conf", "CMakeLists.txt", "west.yml", "idf_component.yml"])
const BUILD_CONFIG_NAMES = new Set(["Makefile", "makefile", "sysbuild.conf", "dependencies.lock", "sample.yaml", "testcase.yaml"])

/**
 * Classify by filename/extension only — no file is opened. Order matters: the exact-name rules run
 * before the extension rules so `main.c` is an entrypoint rather than generic source, and
 * `CMakeLists.txt` is config rather than build-config.
 */
export function classifyEntry(fileName: string): MapEntryKind {
	if (ENTRYPOINT_NAMES.has(fileName)) {
		return "entrypoint"
	}
	if (CONFIG_NAMES.has(fileName) || fileName.startsWith("sdkconfig")) {
		return "config"
	}
	if (/\.overlay$/i.test(fileName) || /\.dts/i.test(fileName) || fileName.startsWith("Kconfig")) {
		return "overlay"
	}
	if (/\.(h|hpp|hh|hxx)$/i.test(fileName)) {
		return "header"
	}
	if (/\.(c|cpp|cc|cxx|py|rs)$/i.test(fileName)) {
		return "source"
	}
	if (/\.md$/i.test(fileName)) {
		return "doc"
	}
	// Build-system files outside the primary config set — present so a `.cmake` module or a
	// west sample manifest is not filed under "other" next to a stray .txt.
	if (BUILD_CONFIG_NAMES.has(fileName) || /\.cmake$/i.test(fileName)) {
		return "build-config"
	}
	return "other"
}

// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------

/**
 * Load `<root>/.gitignore` into the `ignore` matcher the extension ALREADY depends on (it backs
 * ClineIgnoreController). Reusing it is the whole point: gitignore syntax has negation, anchoring
 * and directory semantics, and a hand-rolled "simple pattern" matcher gets one of the three wrong
 * and then quietly hides a source file from the map.
 *
 * Root only. Nested .gitignores are a git feature the map does not need: everything they typically
 * hide (build output, venvs) is already covered by the skip rules above.
 */
async function loadGitignore(root: string): Promise<Ignore | null> {
	try {
		const content = await fs.readFile(path.join(root, ".gitignore"), "utf8")
		return ignore().add(content)
	} catch {
		return null // absent or unreadable — not an error, just no filter
	}
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** Code-unit comparison. `localeCompare` is locale-dependent and would make the output machine-dependent. */
function byPath(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Walk `root` and return the bounded, sorted file map.
 *
 * BREADTH-FIRST on purpose. When the entry cap bites, depth-first would have spent the whole budget
 * inside whichever subtree happened to sort first, and the agent would get a map of one folder.
 * Breadth-first spends the budget on the shallow files — `prj.conf`, `CMakeLists.txt`, the app
 * entrypoints — which are the ones it actually needs.
 *
 * Never throws: an unreadable directory is skipped, a missing root yields an empty map. Memory is
 * an enhancement and must never be able to fail a task.
 */
export async function buildWorkspaceMap(root: string, opts: BuildWorkspaceMapOptions = {}): Promise<WorkspaceMap> {
	const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
	const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
	const ig = opts.useGitignore === false ? null : await loadGitignore(root)

	const entries: WorkspaceMapEntry[] = []
	const depthLimited: string[] = []
	let countLimited = false

	// Relative directory paths (posix, "" = root) whose CONTENTS sit at segment depth `depth + 1`.
	let frontier: string[] = [""]

	for (let depth = 0; depth < maxDepth && frontier.length > 0 && !countLimited; depth++) {
		const next: string[] = []
		for (const relDir of frontier.slice().sort(byPath)) {
			if (countLimited) {
				break
			}
			const absDir = relDir ? path.join(root, relDir) : root
			let dirents: Dirent[]
			try {
				dirents = await fs.readdir(absDir, { withFileTypes: true })
			} catch {
				continue // permission denied, race with a delete, or root does not exist
			}

			for (const dirent of dirents.slice().sort((a, b) => byPath(a.name, b.name))) {
				// Symlinks are never followed: a west workspace routinely links a module back into the
				// tree, and following those turns a bounded walk into an unbounded one.
				if (dirent.isSymbolicLink()) {
					continue
				}
				const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name
				const abs = path.join(absDir, dirent.name)

				if (dirent.isDirectory()) {
					if (shouldSkipDir(dirent.name, abs)) {
						continue
					}
					// Trailing slash so directory-form patterns (`build/`) match as git means them.
					if (ig?.ignores(`${rel}/`)) {
						continue
					}
					next.push(rel)
					continue
				}
				if (!dirent.isFile()) {
					continue // sockets, fifos, block devices
				}
				if (shouldSkipFile(dirent.name) || ig?.ignores(rel)) {
					continue
				}
				if (entries.length >= maxEntries) {
					countLimited = true
					break
				}
				try {
					const st = await fs.stat(abs)
					entries.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs, kind: classifyEntry(dirent.name) })
				} catch {
					// vanished between readdir and stat — leaving it out is the honest result
				}
			}
		}
		frontier = next
	}

	// Whatever is still in the frontier is a directory we chose not to open: either the depth limit
	// stopped us, or the entry cap did. Both are reported rather than silently dropped.
	if (frontier.length > 0) {
		depthLimited.push(...frontier.slice().sort(byPath).slice(0, MAX_DEPTH_LIMITED_RECORDED))
	}

	entries.sort((a, b) => byPath(a.path, b.path))

	const truncation: MapTruncation = {
		truncated: countLimited || depthLimited.length > 0,
		countLimited,
		depthLimited,
		maxDepth,
		maxEntries,
	}
	return attachTruncation(entries, truncation)
}

/**
 * Attach the walk metadata non-enumerably, so `JSON.stringify`, spread and `for…in` see a plain
 * array of entries and only code that asks for `.truncation` finds it.
 */
export function attachTruncation(entries: WorkspaceMapEntry[], truncation: MapTruncation): WorkspaceMap {
	Object.defineProperty(entries, "truncation", { value: truncation, enumerable: false, configurable: true, writable: true })
	return entries as WorkspaceMap
}

/** Read the truncation record off a map, tolerating a plain array (a hand-built list in a test). */
export function getTruncation(entries: WorkspaceMapEntry[]): MapTruncation | undefined {
	return (entries as Partial<WorkspaceMap>).truncation
}
