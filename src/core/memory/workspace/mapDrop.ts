import * as path from "path"
import type { MapTruncation, WorkspaceMapEntry } from "./mapBuilder"

/**
 * Render the workspace file map within a hard character cap.
 *
 * WHY THIS EXISTS: measured on real gateway sessions, the agent burned a median ~1.9K and up to
 * 17K tokens per task purely on orientation (list_files / search_files / reading build config)
 * before doing any actual work, and re-read single files up to 17 times. A small, always-present
 * map replaces that.
 *
 * WHY IT IS DUMB ON PURPOSE: a firmware repo is ~46 source files once `build*` output is excluded.
 * Ranking (PageRank / tree-sitter symbol graphs) solves a problem that does not exist at this size
 * and is where comparable implementations concentrate their bugs. This uses a fixed allowlist and
 * a deterministic drop ladder instead.
 *
 * DETERMINISM IS A HARD REQUIREMENT: the map goes into the cached system prompt, so identical
 * input must produce byte-identical output or every turn pays a cache miss.
 */

export const MAP_CAP_CHARS = 1536

/**
 * Files that are NEVER dropped, at any cap. These are the ones the agent must not have to go
 * looking for: the build configuration that decides what the firmware even is, and the headers
 * under `shared/` that form the contract between the two chips (measured as the single most
 * re-read file class — one such header was read 38 times in a single task).
 */
export function isAlwaysIncluded(relPath: string, appRoots: string[] = []): boolean {
	const base = path.posix.basename(relPath)
	if (
		base === "prj.conf" ||
		base === "CMakeLists.txt" ||
		base === "west.yml" ||
		base === "idf_component.yml" ||
		base.startsWith("sdkconfig") ||
		base.endsWith(".overlay")
	) {
		return true
	}
	// Any header directly inside a `shared/` directory: the cross-chip contract.
	if (/(^|\/)shared\/[^/]+\.(h|hpp)$/.test(relPath)) {
		return true
	}
	// Each app's entry point.
	if (/(^|\/)(main|app_main)\.(c|cpp)$/.test(relPath)) {
		return true
	}
	for (const root of appRoots) {
		const r = root.replace(/\\/g, "/").replace(/\/$/, "")
		if (r && relPath === `${r}/CMakeLists.txt`) {
			return true
		}
	}
	return false
}

const PURPOSE: Partial<Record<string, string>> = {
	"prj.conf": "Zephyr Kconfig for this app",
	"CMakeLists.txt": "build definition",
	"west.yml": "west manifest (SDK + modules)",
	"idf_component.yml": "ESP-IDF component deps",
	sdkconfig: "ESP-IDF resolved config (generated)",
	"sdkconfig.defaults": "ESP-IDF config defaults (edit this one)",
}

function purposeFor(entry: WorkspaceMapEntry): string {
	const base = path.posix.basename(entry.path)
	if (PURPOSE[base]) {
		return PURPOSE[base] as string
	}
	if (base.startsWith("sdkconfig")) {
		return "ESP-IDF config"
	}
	switch (entry.kind) {
		case "entrypoint":
			return "entry point"
		case "overlay":
			return "devicetree / Kconfig overlay"
		case "header":
			return "header"
		case "doc":
			return "doc"
		default:
			return ""
	}
}

const depthOf = (p: string): number => p.split("/").length - 1
const dirOf = (p: string): string => {
	const i = p.lastIndexOf("/")
	return i < 0 ? "." : p.slice(0, i)
}

interface Row {
	entry: WorkspaceMapEntry
	purpose: string
	pinned: boolean
}

function renderRows(rows: Row[], truncation: MapTruncation | undefined, extraNotes: string[]): string {
	const byDir = new Map<string, Row[]>()
	for (const r of rows) {
		const d = dirOf(r.entry.path)
		const list = byDir.get(d)
		if (list) {
			list.push(r)
		} else {
			byDir.set(d, [r])
		}
	}
	const dirs = [...byDir.keys()].sort()

	const lines: string[] = []
	lines.push(`# Workspace map — ${rows.length} file(s)`)
	lines.push("")
	lines.push("A map, not a substitute for reading. Paths are workspace-relative. Use read_file (with")
	lines.push("start_line/end_line) or search_files on these paths instead of re-listing directories.")
	lines.push("")
	for (const d of dirs) {
		lines.push(`${d === "." ? "(root)" : `${d}/`}`)
		for (const r of (byDir.get(d) as Row[]).sort((a, b) => a.entry.path.localeCompare(b.entry.path))) {
			const base = path.posix.basename(r.entry.path)
			lines.push(r.purpose ? `  ${base} — ${r.purpose}` : `  ${base}`)
		}
	}
	for (const n of extraNotes) {
		lines.push(n)
	}
	if (truncation?.truncated) {
		lines.push(
			`(walk stopped early: ${truncation.countLimited ? "entry cap reached" : "depth cap reached"} — use list_files for anything not listed)`,
		)
	}
	return `${lines.join("\n")}\n`
}

/**
 * Apply the drop ladder until the render fits `capChars`.
 *
 * Order (deterministic, documented, tested):
 *   1. never drop the allowlist
 *   2. drop the purpose annotation from the deepest files first
 *   3. drop docs (*.md) outside the allowlist
 *   4. collapse any directory with >6 remaining entries to a one-line summary
 *   5. drop whole directories deepest-first
 */
export function renderMap(
	entries: WorkspaceMapEntry[],
	capChars: number = MAP_CAP_CHARS,
	appRoots: string[] = [],
	truncation?: MapTruncation,
): string {
	const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
	let rows: Row[] = sorted.map((e) => ({
		entry: e,
		purpose: purposeFor(e),
		pinned: isAlwaysIncluded(e.path, appRoots),
	}))
	const notes: string[] = []

	let out = renderRows(rows, truncation, notes)
	if (out.length <= capChars) {
		return out
	}

	// 2. shed purposes, deepest first
	const byDepthDesc = [...rows].sort(
		(a, b) => depthOf(b.entry.path) - depthOf(a.entry.path) || a.entry.path.localeCompare(b.entry.path),
	)
	for (const r of byDepthDesc) {
		if (!r.purpose) {
			continue
		}
		r.purpose = ""
		out = renderRows(rows, truncation, notes)
		if (out.length <= capChars) {
			return out
		}
	}

	// 3. drop docs outside the allowlist
	const docs = rows.filter((r) => !r.pinned && r.entry.kind === "doc")
	if (docs.length) {
		rows = rows.filter((r) => r.pinned || r.entry.kind !== "doc")
		notes.push(`(${docs.length} doc file(s) omitted)`)
		out = renderRows(rows, truncation, notes)
		if (out.length <= capChars) {
			return out
		}
	}

	// 4. collapse fat directories (deepest first), keeping pinned rows visible
	const dirsByDepth = [...new Set(rows.map((r) => dirOf(r.entry.path)))].sort(
		(a, b) => depthOf(b) - depthOf(a) || a.localeCompare(b),
	)
	for (const d of dirsByDepth) {
		const inDir = rows.filter((r) => dirOf(r.entry.path) === d)
		if (inDir.length <= 6) {
			continue
		}
		const keep = inDir.filter((r) => r.pinned)
		const dropped = inDir.length - keep.length
		if (dropped <= 0) {
			continue
		}
		rows = rows.filter((r) => dirOf(r.entry.path) !== d || r.pinned)
		notes.push(`${d}/ — ${dropped} more file(s) (use list_files to enumerate)`)
		out = renderRows(rows, truncation, notes)
		if (out.length <= capChars) {
			return out
		}
	}

	// 5. drop whole directories deepest-first, pinned rows excepted
	let droppedDirs = 0
	for (const d of dirsByDepth) {
		const inDir = rows.filter((r) => dirOf(r.entry.path) === d)
		if (!inDir.length || inDir.every((r) => r.pinned)) {
			continue
		}
		rows = rows.filter((r) => dirOf(r.entry.path) !== d || r.pinned)
		droppedDirs++
		const withNote = [...notes, `(${droppedDirs} director${droppedDirs === 1 ? "y" : "ies"} omitted)`]
		out = renderRows(rows, truncation, withNote)
		if (out.length <= capChars) {
			return out
		}
	}
	if (droppedDirs > 0) {
		notes.push(`(${droppedDirs} director${droppedDirs === 1 ? "y" : "ies"} omitted)`)
	}

	// Floor: the allowlist alone. Never hard-cut mid-line — an unparseable map is worse than a short one.
	return renderRows(rows, truncation, notes)
}
