import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { load as yamlLoad } from "js-yaml"
import { HostProvider } from "@/hosts/host-provider"
import { extractFrontmatter } from "@/services/knowledge/kbit/frontmatter"
import type { ArtifactFetch } from "@/services/knowledge/registry/RegistryClient"
import { espToolActive, nrfToolActive } from "@/services/platform/platformRouting"
import type { WorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { commandPrefix, launcherName, renderCommand, type ToolRuntime } from "./launchers"
import type { ToolCache } from "./ToolCache"

/**
 * Resolve TOOL bits to something runnable, and advertise only what is actually on disk.
 *
 * A tool bit is a k-bit of `type: tool` plus a bundle of files. Bundled tools ship in the VSIX under
 * `iot-knowledge/platforms/<plat>/tools/<name>/`; downloaded ones will be materialised into a tool
 * cache (phase 3) — the shape returned here is identical either way, so the prompt and the handlers
 * never learn where a tool came from.
 *
 * Two rules this module exists to enforce:
 *   1. **Never advertise a tool that cannot run.** The agent takes an advertised path as a promise. An
 *      earlier build advertised a wrapper that was not reachable, and the agent hand-rolled a
 *      Windows-only serial script instead — worse than having no tool at all. So a tool appears only
 *      when its entry file is verified present, and any missing prerequisite is stated in the line.
 *   2. **A task sees one stable set.** Resolution is snapshotted per task, so a cache write midway
 *      through cannot change the tools the agent was told about.
 */

const KNOWLEDGE_DIR = "iot-knowledge"

export interface ResolvedTool {
	id: string
	/** Last path segment of the id — the tool's user-facing name and its launcher's filename. */
	name: string
	dir: string
	entryPath: string
	runtime: ToolRuntime
	usage: string
	summary: string
	safety: string[]
	readonly: boolean
	requiresTools: string[]
	platform?: string
	author?: string
	coAuthors?: string[]
	license?: string
	delivery: "bundled" | "downloaded"
	/** The shell-ready command prefix, already quoted and shortened where useful. */
	command: string
	/** Present when something the tool needs is missing; the advertisement says so plainly. */
	unavailable?: string
}

interface ManifestEntry {
	id: string
	path: string
}

function knowledgeRoot(): string {
	return path.join(HostProvider.get().extensionFsPath, KNOWLEDGE_DIR)
}

// ── interpreter probe ────────────────────────────────────────────────────────
// Probe by RUNNING a candidate, never by looking it up on PATH: on Windows `python3` is usually the
// Microsoft Store alias stub, which exists, prints "Python was not found" and exits 49. Cached for
// the session — spawning three processes per prompt build would be absurd.
let interpreterProbe: { value: string | null } | null = null

export function probePython(): string | null {
	if (interpreterProbe) {
		return interpreterProbe.value
	}
	for (const candidate of ["python3", "python", "py"]) {
		try {
			execFileSync(candidate, ["-c", "import sys; sys.exit(0)"], { stdio: "ignore", timeout: 5000 })
			interpreterProbe = { value: candidate }
			return candidate
		} catch {
			// try the next candidate
		}
	}
	interpreterProbe = { value: null }
	return null
}

/** Test seam: forget the cached probe. */
export function resetProbeCache(): void {
	interpreterProbe = null
}

/** True if an external executable the tool shells out to is on PATH and runs. */
function haveExecutable(name: string): boolean {
	try {
		execFileSync(name, ["--version"], { stdio: "ignore", timeout: 5000 })
		return true
	} catch {
		return false
	}
}

// ── descriptor loading ───────────────────────────────────────────────────────

/** Pure: the tool entries of a bundled manifest. */
export function toolEntriesFromManifest(manifestText: string): ManifestEntry[] {
	try {
		const parsed = JSON.parse(manifestText)
		const rows: ManifestEntry[] = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed?.bits)
				? parsed.bits
				: Object.entries(parsed?.bits ?? parsed ?? {}).map(([id, p]) => ({ id, path: String(p) }))
		return rows.filter((r) => typeof r?.path === "string" && /(^|\/)TOOL\.md$/.test(r.path))
	} catch {
		return []
	}
}

/**
 * Pure: turn a descriptor's frontmatter into a ResolvedTool, or explain why it cannot run.
 * `fileExists` is injected so this is testable without a filesystem.
 */
export function buildResolvedTool(args: {
	id: string
	dir: string
	meta: Record<string, unknown>
	body: string
	delivery: "bundled" | "downloaded"
	fileExists: (p: string) => boolean
	interpreter: string | null
	haveExecutable: (name: string) => boolean
	cwd?: string
	platform?: NodeJS.Platform
}): ResolvedTool | null {
	const { id, dir, meta, body, fileExists } = args
	const runtime = meta.runtime as ToolRuntime | undefined
	const entry = typeof meta.entry === "string" ? meta.entry : undefined
	if (!runtime || !entry) {
		return null // not a runnable tool descriptor; the schema refuses these at publish
	}
	const name = id.split("/").pop() ?? id
	const entryPath = path.join(dir, entry)

	// Rule 1: an entry that is not on disk is not a tool. Say nothing rather than promise a path.
	if (!fileExists(entryPath)) {
		return null
	}

	const launcher = path.join(dir, launcherName(name, args.platform ?? process.platform))
	const launcherPath = fileExists(launcher) ? launcher : undefined

	const requiresTools = Array.isArray(meta.requires_tools) ? (meta.requires_tools as string[]) : []
	const missingExternal = requiresTools.filter((t) => !args.haveExecutable(t))
	let unavailable: string | undefined
	if (runtime === "python3" && !args.interpreter) {
		unavailable = "needs Python 3 — not found on this machine"
	} else if (missingExternal.length) {
		unavailable = `${missingExternal.join(", ")} not found on PATH`
	}

	return {
		id,
		name,
		dir,
		entryPath,
		runtime,
		usage: typeof meta.usage === "string" ? meta.usage : "",
		summary:
			body
				.trim()
				.split("\n")
				.find((l) => l.trim().length > 0)
				?.trim() ?? "",
		safety: Array.isArray(meta.safety) ? (meta.safety as string[]) : [],
		readonly: meta.readonly === true,
		requiresTools,
		platform: typeof meta.platform === "string" ? meta.platform : undefined,
		author: typeof meta.author === "string" ? meta.author : undefined,
		coAuthors: Array.isArray(meta.co_authors)
			? (meta.co_authors as Array<Record<string, unknown> | string>)
					.map((c) => (typeof c === "string" ? c : typeof c?.name === "string" ? (c.name as string) : ""))
					.filter(Boolean)
			: undefined,
		license: typeof meta.license === "string" ? meta.license : undefined,
		delivery: args.delivery,
		command: renderCommand(
			commandPrefix({ runtime, launcherPath, entryPath, interpreter: args.interpreter ?? undefined }),
			args.cwd,
		),
		unavailable,
	}
}

/** Pure: which tools this workspace should see. Mirrors the native device-tool gating exactly. */
export function toolsForWorkspace(tools: ResolvedTool[], summary: WorkspaceSummary): ResolvedTool[] {
	return tools.filter((t) => {
		if (t.platform === "nrf") {
			return nrfToolActive(summary)
		}
		if (t.platform === "esp") {
			return espToolActive(summary)
		}
		return true // platform-agnostic tools are always available
	})
}

// ── the resolver ─────────────────────────────────────────────────────────────

let snapshot: { key: string; tools: ResolvedTool[] } | null = null

/** Read every bundled tool descriptor from disk. Downloaded tools join this list in phase 3. */
export function loadBundledTools(cwd?: string): ResolvedTool[] {
	const root = knowledgeRoot()
	const manifestPath = path.join(root, "manifest.json")
	if (!existsSync(manifestPath)) {
		return []
	}
	const interpreter = probePython()
	const out: ResolvedTool[] = []
	for (const entry of toolEntriesFromManifest(readFileSync(manifestPath, "utf-8"))) {
		const abs = path.join(root, entry.path)
		if (!existsSync(abs)) {
			continue
		}
		try {
			const raw = readFileSync(abs, "utf-8")
			const fm = extractFrontmatter(raw)
			if (!fm.found || !fm.closed) {
				continue
			}
			const meta = yamlLoad(fm.yaml) as Record<string, unknown> | null
			if (!meta || typeof meta !== "object") {
				continue
			}
			const body = fm.body
			const tool = buildResolvedTool({
				id: entry.id,
				dir: path.dirname(abs),
				meta,
				body,
				delivery: "bundled",
				fileExists: existsSync,
				interpreter,
				haveExecutable,
				cwd,
			})
			if (tool) {
				out.push(tool)
			}
		} catch {
			// A malformed descriptor must never break prompt assembly — skip it.
		}
	}
	return out.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * The tools to advertise for this workspace, snapshotted per task so the set cannot change under the
 * agent mid-conversation. `taskKey` is the task id; pass a fresh one to rebuild.
 */
export function resolveTools(summary: WorkspaceSummary, taskKey: string, cwd?: string): ResolvedTool[] {
	const key = `${taskKey}::${summary}::${cwd ?? ""}`
	if (snapshot?.key === key) {
		return snapshot.tools
	}
	const tools = toolsForWorkspace(loadBundledTools(cwd), summary)
	snapshot = { key, tools }
	return tools
}

/** Test seam: drop the per-task snapshot. */
export function resetToolSnapshot(): void {
	snapshot = null
}

/** The absolute launcher/entry path for one tool id, for the native handlers. Null if unresolvable. */
export function pathOf(id: string, cwd?: string): string | null {
	const tool = loadBundledTools(cwd).find((t) => t.id === id)
	if (!tool) {
		return null
	}
	const launcher = path.join(tool.dir, launcherName(tool.name))
	return existsSync(launcher) ? launcher : tool.entryPath
}

// ── downloaded tools ─────────────────────────────────────────────────────────

/**
 * Turn a manifest entry for a `type: tool` bit into a runnable tool, materialising its bundle if the
 * cache does not already hold a verified copy.
 *
 * Order matches knowledge bits: bundled wins, then a verified cache hit, then the registry. A tool is
 * returned ONLY when its bundle is verified on disk — a locked or unreachable artifact yields null,
 * so nothing half-available is ever advertised.
 */
export async function materialiseDownloadedTool(args: {
	entry: Record<string, unknown>
	cache: ToolCache
	fetchArtifact: (sha256: string) => Promise<ArtifactFetch>
	cwd?: string
	interpreter?: string | null
	haveExec?: (name: string) => boolean
}): Promise<ResolvedTool | null> {
	const { entry, cache } = args
	const id = typeof entry.id === "string" ? entry.id : null
	const version = typeof entry.version === "string" ? entry.version : null
	const declared = Array.isArray(entry.artifacts) ? (entry.artifacts as Array<Record<string, unknown>>) : []
	if (!id || !version || declared.length === 0) {
		return null
	}
	const members = declared
		.map((a) => ({ path: String(a.path ?? ""), sha256: String(a.sha256 ?? "") }))
		.filter((m) => m.path && m.sha256)
	if (members.length !== declared.length) {
		return null // a descriptor missing a hash cannot be verified, so it is not usable
	}

	if (!cache.verify(id, version, members)) {
		const fetched: Array<{ path: string; bytes: Buffer; sha256: string }> = []
		for (const m of members) {
			const r = await args.fetchArtifact(m.sha256)
			if (r.kind !== "ok") {
				// locked / absent / unreachable are all "not runnable now". The locked case is surfaced by
				// the caller as a paywall; here it simply means do not advertise.
				return null
			}
			fetched.push({ path: m.path, bytes: r.bytes, sha256: m.sha256 })
		}
		if (!cache.materialise(id, version, fetched)) {
			return null
		}
	}

	return buildResolvedTool({
		id,
		dir: cache.dirFor(id, version),
		meta: entry,
		body: typeof entry.summary === "string" ? entry.summary : "",
		delivery: "downloaded",
		fileExists: existsSync,
		interpreter: args.interpreter ?? probePython(),
		haveExecutable: args.haveExec ?? haveExecutable,
		cwd: args.cwd,
	})
}

/** Manifest rows that are tool bits. Kept pure so it is testable without a registry. */
export function toolEntriesFromDownloadedManifest(bits: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	return bits.filter((b) => b?.type === "tool" && Array.isArray(b.artifacts) && b.artifacts.length > 0)
}
