import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { load as yamlLoad } from "js-yaml"
import { HostProvider } from "@/hosts/host-provider"
import { extractFrontmatter } from "@/services/knowledge/kbit/frontmatter"
import { choose } from "@/services/knowledge/precedence"
import type { ArtifactFetch } from "@/services/knowledge/registry/RegistryClient"
import { espToolActive, nrfToolActive } from "@/services/platform/platformRouting"
import type { WorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { commandPrefix, launcherName, renderCommand, type ToolRuntime } from "./launchers"
import type { ToolCache } from "./ToolCache"
import { signatureAllowsRun, verifyVersionSignature } from "./verifySignature"

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

/** Launcher members a python bundle must carry for the platform it is about to run on. */
export function bundleHasPlatformLauncher(id: string, row: Record<string, unknown>, platform: NodeJS.Platform = process.platform): boolean {
	if (row.runtime !== "python3") {
		return true // node tools run under the editor's own binary; there is no launcher to lose
	}
	const name = id.split("/").pop() ?? id
	const want = launcherName(name, platform)
	const artifacts = Array.isArray(row.artifacts) ? (row.artifacts as Array<Record<string, unknown>>) : []
	return artifacts.some((a) => String(a.path ?? "") === want)
}

/** The signature verdict for a catalog row, in the shape verifyVersionSignature expects. */
function verdictFor(row: Record<string, unknown>) {
	return verifyVersionSignature({
		id: String(row.id ?? ""),
		version: String(row.version ?? ""),
		content_hash: typeof row.content_hash === "string" ? row.content_hash : "",
		artifacts: Array.isArray(row.artifacts) ? (row.artifacts as Array<{ sha256?: unknown }>) : [],
		signature: typeof row.signature === "string" ? row.signature : null,
	})
}

/**
 * An override may not widen what the developer already agreed to.
 *
 * Auto-approval is computed from the resolved descriptor, so a registry copy that dropped a `safety`
 * tag or flipped `readonly` would silently turn a tool that used to ask into one that just runs —
 * a privilege change nobody was shown. Narrowing is fine; widening takes a new session.
 */
export function noWiderThan(override: ResolvedTool, shipped: ResolvedTool): ResolvedTool {
	return {
		...override,
		readonly: override.readonly && shipped.readonly,
		safety: [...new Set([...override.safety, ...shipped.safety])],
	}
}

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
	/**
	 * Where this tool's CANONICAL home is, as the descriptor declares it. Distribution metadata, not a
	 * statement about this resolution — the registry serves copies of bundled tools, so a row can say
	 * `bundled` and still have arrived over the wire. Use `provenance` for what actually happened.
	 */
	delivery: "bundled" | "downloaded"
	/** The version that actually resolved. Needed to credit the copy that ran, not the one on disk. */
	version?: string
	/** What actually served this tool: the VSIX, the registry, or the registry replacing the VSIX. */
	provenance: "bundled" | "downloaded" | "override"
	/** The shell-ready command prefix, already quoted and shortened where useful. */
	command: string
	/** Present when something the tool needs is missing; the advertisement says so plainly. */
	unavailable?: string
}

/**
 * Why a tool could not be resolved. The door that reports "tool unavailable" to the developer needs
 * to know WHICH of these happened — "never fetched" and "the registry is down" and "your plan does
 * not include it" are three different conversations, and a bare null could not tell them apart.
 */
export type ToolUnavailable =
	/** No copy on this machine and the artifact was not in the registry. */
	| "not-fetched"
	/** The registry could not be reached. */
	| "registry-unreachable"
	/** The artifact exists but this account is not entitled to it. */
	| "locked"
	/** Signature enforcement is on and the published version does not verify. */
	| "signature-refused"
	/** The bundle materialised but its entry file is not on disk. */
	| "entry-missing"
	/** The descriptor is missing fields needed to run it. */
	| "incomplete-descriptor"

export type ToolResolution = { tool: ResolvedTool } | { unavailable: ToolUnavailable }

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
	/** What actually served it. Defaults to `delivery` for callers that predate the override rule. */
	provenance?: "bundled" | "downloaded" | "override"
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
		provenance: args.provenance ?? args.delivery,
		version: typeof args.meta.version === "string" ? args.meta.version : undefined,
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

/**
 * Resolution is snapshotted per key so a cache write midway through a task cannot change the tools the
 * agent was told about. A MAP rather than one slot: prompt assembly resolves under `prompt:<cwd>` and
 * the execute handler under `task:<ulid>`, and with a single slot those two thrashed each other — the
 * agent could be advertised one set and credited from another. Bounded; oldest key evicted.
 */
const snapshots = new Map<string, ResolvedTool[]>()
const SNAPSHOT_LIMIT = 8

function snapshotGet(key: string): ResolvedTool[] | undefined {
	return snapshots.get(key)
}

function snapshotSet(key: string, tools: ResolvedTool[]): ResolvedTool[] {
	if (snapshots.size >= SNAPSHOT_LIMIT) {
		const oldest = snapshots.keys().next().value
		if (oldest !== undefined) {
			snapshots.delete(oldest)
		}
	}
	snapshots.set(key, tools)
	return tools
}

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
	const hit = snapshotGet(key)
	if (hit) {
		return hit
	}
	return snapshotSet(key, toolsForWorkspace(loadBundledTools(cwd), summary))
}

/**
 * The async entry point: bundled tools PLUS any downloaded ones the registry serves and the cache can
 * verify. Prompt assembly is already async, so this is what it calls; `resolveTools` stays for the
 * synchronous callers (the native handlers) that only ever want a bundled path.
 *
 * On a duplicate id the NEWER copy wins if this extension can run it, exactly as for knowledge bits
 * (`services/knowledge/precedence.ts`). The bundled copy is the last resort and is always reachable.
 */
export async function resolveToolsAsync(summary: WorkspaceSummary, taskKey: string, cwd?: string): Promise<ResolvedTool[]> {
	const key = `async::${taskKey}::${summary}::${cwd ?? ""}`
	const hit = snapshotGet(key)
	if (hit) {
		return hit
	}
	const bundled = loadBundledTools(cwd)
	const byId = new Map(bundled.map((t) => [t.id, t]))
	try {
		const { downloadedEntries, precedenceEnvFor } = await import("@/services/knowledge/KnowledgeResolver")
		const { RegistryClient } = await import("@/services/knowledge/registry/RegistryClient")
		const { ToolCache } = await import("./ToolCache")
		const entries = toolEntriesFromDownloadedManifest(await downloadedEntries())
		if (entries.length) {
			const client = new RegistryClient()
			const cache = new ToolCache(toolCacheRoot())
			const live: Array<{ id: string; version: string }> = []
			for (const entry of entries) {
				const id = String(entry.id ?? "")
				if (!id) {
					continue
				}
				const shipped = byId.get(id) ?? null
				// The same rule the knowledge resolver uses. A newer registry copy replaces a bundled tool
				// only when this extension can run it AND the descriptor is complete enough not to degrade
				// the advertisement — a stale-but-complete tool beats a newer one that loses its safety
				// tags or its platform launcher.
				const decision = choose(id, shipped ? { version: shipped.version } : null, entry, {
					...precedenceEnvFor(),
					kind: "tool",
					signatureOk: (row) => signatureAllowsRun(verdictFor(row)),
					hasPlatformLauncher: (row) => bundleHasPlatformLauncher(id, row),
				})
				if (decision.copy !== "registry") {
					continue // keep the bundled tool
				}
				const got = await materialiseDownloadedToolResult({
					entry,
					cache,
					fetchArtifact: (sha) => client.fetchArtifact(sha),
					cwd,
					provenance: shipped ? "override" : "downloaded",
				})
				if ("tool" in got) {
					// An override may never WIDEN what the developer already agreed to. If the shipped
					// descriptor was stricter, the stricter answer is the one that stands for this session.
					byId.set(id, shipped ? noWiderThan(got.tool, shipped) : got.tool)
					live.push({ id, version: String(entry.version ?? "") })
				}
			}
			// Versioned cache dirs are what makes bundled and registry copies coexist safely, but nothing
			// swept them until now — with overrides, a new directory per publish is the normal case, not
			// the exception. Bundled versions are named as live so a running copy is never removed.
			try {
				for (const b of bundled) {
					if (b.version) {
						live.push({ id: b.id, version: b.version })
					}
				}
				cache.reconcile(live)
			} catch {
				// housekeeping must never cost the developer their tools
			}
		}
	} catch {
		// The registry being unreachable must never cost the developer their bundled tools.
	}
	return snapshotSet(
		key,
		toolsForWorkspace(
			[...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
			summary,
		),
	)
}

/** Where downloaded bundles are materialised — beside the k-bit cache, never mixed into it. */
export function toolCacheRoot(): string {
	return path.join(HostProvider.get().globalStorageFsPath ?? HostProvider.get().extensionFsPath, "tbit-cache")
}

/** Test seam: drop every cached snapshot. */
export function resetToolSnapshot(): void {
	snapshots.clear()
}

/**
 * Resolve ONE tool by id, the way a handler about to run it needs: the winning copy, or the reason
 * there isn't one.
 *
 * Unlike `pathOf`, this consults the registry, so a bundled tool that has been improved in the
 * registry is the copy that actually runs. A registry problem is never allowed to become the
 * developer's problem: any failure falls back to the bundled tool if there is one, and only an id
 * with no bundled copy AND no usable registry copy comes back unavailable.
 */
export async function resolveToolAsync(id: string, cwd?: string): Promise<ToolResolution> {
	const shipped = loadBundledTools(cwd).find((t) => t.id === id) ?? null
	try {
		const { downloadedEntries, precedenceEnvFor } = await import("@/services/knowledge/KnowledgeResolver")
		const { RegistryClient } = await import("@/services/knowledge/registry/RegistryClient")
		const { ToolCache } = await import("./ToolCache")
		const entry = toolEntriesFromDownloadedManifest(await downloadedEntries()).find((e) => String(e.id ?? "") === id)
		if (entry) {
			const decision = choose(id, shipped ? { version: shipped.version } : null, entry, {
				...precedenceEnvFor(),
				kind: "tool",
				signatureOk: (row) => signatureAllowsRun(verdictFor(row)),
				hasPlatformLauncher: (row) => bundleHasPlatformLauncher(id, row),
			})
			if (decision.copy === "registry") {
				const client = new RegistryClient()
				const got = await materialiseDownloadedToolResult({
					entry,
					cache: new ToolCache(toolCacheRoot()),
					fetchArtifact: (sha) => client.fetchArtifact(sha),
					cwd,
					provenance: shipped ? "override" : "downloaded",
				})
				if ("tool" in got) {
					return { tool: shipped ? noWiderThan(got.tool, shipped) : got.tool }
				}
				if (!shipped) {
					return got // nothing to fall back to — report why
				}
			}
		} else if (!shipped) {
			return { unavailable: "not-fetched" }
		}
	} catch {
		if (!shipped) {
			return { unavailable: "registry-unreachable" }
		}
	}
	return shipped ? { tool: shipped } : { unavailable: "not-fetched" }
}

/**
 * The absolute launcher/entry path for one tool id, honouring a registry override.
 *
 * The native handlers use this. It never throws for a registry reason — a capture must not fail
 * because a fetch was slow — so the caller's "tool bundle is missing" error stays reserved for the
 * case where there is genuinely no copy at all.
 */
export async function pathOfAsync(id: string, cwd?: string): Promise<{ tool: ResolvedTool; path: string } | null> {
	const r = await resolveToolAsync(id, cwd)
	if (!("tool" in r)) {
		return null
	}
	const launcher = path.join(r.tool.dir, launcherName(r.tool.name))
	return { tool: r.tool, path: existsSync(launcher) ? launcher : r.tool.entryPath }
}

/**
 * The absolute launcher/entry path for one BUNDLED tool id. Never consults the registry.
 *
 * Kept for callers that genuinely cannot await. Anything that is about to EXECUTE a tool should use
 * `pathOfAsync` instead, or it will run the VSIX copy while the prompt advertised the registry one.
 */
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
	const r = await materialiseDownloadedToolResult(args)
	return "tool" in r ? r.tool : null
}

/**
 * The same work, reporting WHY it failed.
 *
 * A door that has to tell the developer "this could not run" needs the difference between "it was
 * never fetched", "the registry is down", "your plan does not include it" and "the signature did not
 * verify". The `| null` form above stays for callers that only need a tool or nothing.
 */
export async function materialiseDownloadedToolResult(args: {
	entry: Record<string, unknown>
	cache: ToolCache
	fetchArtifact: (sha256: string) => Promise<ArtifactFetch>
	cwd?: string
	interpreter?: string | null
	haveExec?: (name: string) => boolean
	provenance?: "downloaded" | "override"
}): Promise<ToolResolution> {
	const { entry, cache } = args
	const id = typeof entry.id === "string" ? entry.id : null
	const version = typeof entry.version === "string" ? entry.version : null
	const declared = Array.isArray(entry.artifacts) ? (entry.artifacts as Array<Record<string, unknown>>) : []
	if (!id || !version || declared.length === 0) {
		return { unavailable: "incomplete-descriptor" }
	}

	// Verify the steward signature BEFORE fetching anything. The hashes in this entry came from the
	// registry, so checking bytes against them only proves the registry is self-consistent — a
	// compromised one would simply serve matching bytes for hashes it chose. The signature is what a
	// compromised registry cannot forge, so it gates the whole operation.
	const verdict = verifyVersionSignature({
		id,
		version,
		content_hash: typeof entry.content_hash === "string" ? entry.content_hash : "",
		artifacts: declared as Array<{ sha256?: unknown }>,
		signature: typeof entry.signature === "string" ? entry.signature : null,
	})
	if (!signatureAllowsRun(verdict)) {
		return { unavailable: "signature-refused" }
	}
	const members = declared
		.map((a) => ({ path: String(a.path ?? ""), sha256: String(a.sha256 ?? "") }))
		.filter((m) => m.path && m.sha256)
	if (members.length !== declared.length) {
		// a descriptor missing a hash cannot be verified, so it is not usable
		return { unavailable: "incomplete-descriptor" }
	}

	if (!cache.verify(id, version, members)) {
		const fetched: Array<{ path: string; bytes: Buffer; sha256: string }> = []
		for (const m of members) {
			const r = await args.fetchArtifact(m.sha256)
			if (r.kind !== "ok") {
				// locked / absent / unreachable are all "not runnable now", but they are different
				// conversations with the developer, so the reason travels with the refusal.
				return {
					unavailable:
						r.kind === "locked" ? "locked" : r.kind === "unreachable" ? "registry-unreachable" : "not-fetched",
				}
			}
			fetched.push({ path: m.path, bytes: r.bytes, sha256: m.sha256 })
		}
		if (!cache.materialise(id, version, fetched)) {
			return { unavailable: "not-fetched" }
		}
	}

	const tool = buildResolvedTool({
		id,
		dir: cache.dirFor(id, version),
		meta: entry,
		body: typeof entry.summary === "string" ? entry.summary : "",
		delivery: "downloaded",
		provenance: args.provenance ?? "downloaded",
		fileExists: existsSync,
		interpreter: args.interpreter ?? probePython(),
		haveExecutable: args.haveExec ?? haveExecutable,
		cwd: args.cwd,
	})
	return tool ? { tool } : { unavailable: "entry-missing" }
}

/** Manifest rows that are tool bits. Kept pure so it is testable without a registry. */
export function toolEntriesFromDownloadedManifest(bits: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	return bits.filter((b) => b?.type === "tool" && Array.isArray(b.artifacts) && b.artifacts.length > 0)
}
