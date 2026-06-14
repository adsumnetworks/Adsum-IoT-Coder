/**
 * `kbit` — the P1 local authoring + inspection CLI.
 *
 *   npm run kbit -- ls [--platform nrf --type workflow --tier certified --status published]
 *   npm run kbit -- tree
 *   npm run kbit -- show <id>
 *   npm run kbit -- lint
 *   npm run kbit -- new          (interactive wizard → scaffolds a conformant bit)
 *   npm run kbit -- edit <id>    (interactive: change frontmatter / add an endorser; body preserved)
 *
 * Pure logic lives in src/services/knowledge/kbit/{authoring,inspect,lint,schema}.ts — this file is
 * just IO + prompts. Design: target-architecture/05 §3 + 06 §E.
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { stdin, stdout } from "node:process"
import * as readline from "node:readline/promises"
import { load as yamlLoad } from "js-yaml"
import { composeBit, generateFrontmatter, generateTestStub } from "../src/services/knowledge/kbit/authoring"
import { extractFrontmatter } from "../src/services/knowledge/kbit/frontmatter"
import {
	formatBitDetail,
	formatCatalog,
	formatTree,
	loadCatalog,
	type ManifestEntry,
} from "../src/services/knowledge/kbit/inspect"
import { deriveId, lintBitContent, lintCorpus, listBitFiles } from "../src/services/knowledge/kbit/lint"
import { type KBitMeta, kbitMetaSchema } from "../src/services/knowledge/kbit/schema"

const REPO = join(__dirname, "..")
const KB = join(REPO, "iot-knowledge")
const MANIFEST = join(KB, "manifest.json")
const FIXTURES = join(REPO, "kbit-fixtures")

function readCatalog(): ManifestEntry[] {
	if (!existsSync(MANIFEST)) {
		console.error("manifest.json not found — run `npm run gen:kbit-manifest` first.")
		return []
	}
	return loadCatalog(readFileSync(MANIFEST, "utf8"))
}

/** First/last commit dates for a bit file (display only; never persisted — keeps the manifest deterministic). */
function gitDates(relFromKb: string): { created?: string; updated?: string } {
	try {
		const out = execSync(`git log --follow --format=%ad --date=short -- "iot-knowledge/${relFromKb}"`, {
			cwd: REPO,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()
		if (!out) {
			return {}
		}
		const lines = out.split(/\r?\n/)
		return { updated: lines[0], created: lines[lines.length - 1] }
	} catch {
		return {}
	}
}

function parseFlags(args: string[]): Record<string, string> {
	const flags: Record<string, string> = {}
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			flags[args[i].slice(2)] = args[i + 1] ?? ""
			i++
		}
	}
	return flags
}

// ── read-only commands ─────────────────────────────────────────────────────────

function cmdLs(args: string[]): void {
	const f = parseFlags(args)
	const entries = readCatalog().filter(
		(e) =>
			(!f.platform || e.platform === f.platform) &&
			(!f.type || e.type === f.type) &&
			(!f.tier || e.tier === f.tier) &&
			(!f.status || (e.status ?? "published") === f.status),
	)
	console.log(formatCatalog(entries))
}

function cmdTree(): void {
	console.log(formatTree(readCatalog()))
}

function cmdShow(id: string): void {
	if (!id) {
		console.error("usage: kbit show <id>")
		process.exitCode = 1
		return
	}
	const entry = readCatalog().find((e) => e.id === id)
	if (!entry) {
		console.error(`unknown bit id "${id}" (not in manifest). Try \`kbit ls\`.`)
		process.exitCode = 1
		return
	}
	console.log(formatBitDetail(entry, gitDates(entry.path)))
}

function cmdLint(): void {
	const { issues, files, migrated } = lintCorpus(KB)
	for (const i of issues) {
		console.log(`  [${i.level}] ${i.file}: ${i.msg}`)
	}
	const errors = issues.filter((i) => i.level === "error").length
	const warns = issues.filter((i) => i.level === "warn").length
	console.log(`\nK-bit lint: ${files.length} bits · ${migrated} migrated · ${errors} errors · ${warns} warnings`)
	if (errors > 0) {
		process.exitCode = 1
	}
}

// ── authoring wizard ────────────────────────────────────────────────────────────

const csv = (s: string): string[] =>
	s
		? s
				.split(",")
				.map((x) => x.trim())
				.filter(Boolean)
		: []
const today = (): string => new Date().toISOString().slice(0, 10)

async function ask(rl: readline.Interface, q: string, def?: string): Promise<string> {
	const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim()
	return a || def || ""
}

/** Build a KBitMeta from prompts, pre-filled from `cur` when editing. Validates before returning. */
async function promptMeta(rl: readline.Interface, relPath: string, cur?: Partial<KBitMeta>): Promise<KBitMeta> {
	const id = deriveId(relPath)
	console.log(`\nid (derived from path): ${id}\n`)
	const type = (await ask(rl, "type (workflow|action|knowledge)", cur?.type ?? "knowledge")) as KBitMeta["type"]

	const meta: Record<string, unknown> = {
		id,
		title: await ask(rl, "title", cur?.title),
		type,
		version: await ask(rl, "version", cur?.version ?? "1.0.0"),
		owner: await ask(rl, "owner (adsum-core|adsum-extended|community|partner)", cur?.owner ?? "adsum-core"),
		author: await ask(rl, "author (primary handle)", cur?.author ?? "adsum"),
		license: await ask(rl, "license", cur?.license ?? "CC-BY-SA-4.0"),
		tier: await ask(rl, "tier (community|certified)", cur?.tier ?? "certified"),
		delivery: await ask(rl, "delivery (bundled|downloaded)", cur?.delivery ?? "bundled"),
		domain: await ask(rl, "domain", cur?.domain ?? "embedded-iot"),
		platform: await ask(rl, "platform (nrf|esp|universal)", cur?.platform ?? "nrf"),
		status: await ask(rl, "status (draft|published|deprecated|revoked)", cur?.status ?? (cur ? "published" : "draft")),
	}
	if (type === "workflow") {
		meta.triggers = csv(await ask(rl, "triggers (comma-separated)", cur?.triggers?.join(", ")))
	}
	const requires = csv(await ask(rl, "requires — bit ids (comma-separated, optional)", cur?.requires?.join(", ")))
	if (requires.length) {
		meta.requires = requires
	}
	const safety = csv(await ask(rl, "safety tags (comma-separated, optional)", cur?.safety?.join(", ")))
	if (safety.length) {
		meta.safety = safety
	}
	const coAuthors = csv(
		await ask(rl, "co-author handles (comma-separated, optional)", cur?.co_authors?.map((c) => c.handle).join(", ")),
	)
	if (coAuthors.length) {
		meta.co_authors = coAuthors.map((handle) => ({ handle }))
	}
	const supporters = csv(
		await ask(
			rl,
			"supporter handles (sponsor/backer, comma-separated, optional)",
			cur?.supporters?.map((s) => s.handle).join(", "),
		),
	)
	if (supporters.length) {
		meta.supporters = supporters.map((handle) => ({ handle, kind: "sponsor" as const }))
	}
	// Preserve any existing endorsers when editing (add new ones via the explicit prompt below).
	if (cur?.endorsers?.length) {
		meta.endorsers = cur.endorsers
	}
	return kbitMetaSchema.parse(meta)
}

async function cmdNew(args: string[]): Promise<void> {
	const flags = parseFlags(args)

	// Non-interactive path (scriptable + testable): `kbit new --from spec.json`
	// where spec.json is `{ "path": "platforms/nrf/actions/foo.md", ...frontmatter fields }`.
	if (flags.from) {
		const spec = JSON.parse(readFileSync(flags.from, "utf8")) as { path?: string } & Record<string, unknown>
		const relPath = spec.path
		if (!relPath?.endsWith(".md")) {
			console.error("spec.path is required and must end in .md")
			process.exitCode = 1
			return
		}
		const { path: _p, ...rest } = spec
		const meta = kbitMetaSchema.parse({ ...rest, id: deriveId(relPath) })
		writeBit(relPath, meta)
		finishAuthoring(relPath)
		return
	}

	const rl = readline.createInterface({ input: stdin, output: stdout })
	try {
		const relPath = await ask(rl, "path under iot-knowledge/ (e.g. platforms/nrf/actions/foo.md)")
		if (!relPath.endsWith(".md")) {
			console.error("path must end in .md")
			process.exitCode = 1
			return
		}
		if (existsSync(join(KB, relPath))) {
			console.error(`refusing to overwrite existing file: ${relPath} (use \`kbit edit ${deriveId(relPath)}\`)`)
			process.exitCode = 1
			return
		}
		writeBit(relPath, await promptMeta(rl, relPath))
		finishAuthoring(relPath)
	} finally {
		rl.close()
	}
}

/** Write the bit file + its bring-a-test stub. */
function writeBit(relPath: string, meta: KBitMeta): void {
	const full = join(KB, relPath)
	const basename = relPath.split("/").pop() ?? relPath
	mkdirSync(dirname(full), { recursive: true })
	writeFileSync(full, composeBit(meta, basename), "utf8")
	console.log(`\n✓ wrote ${relPath}`)
	const fixtureRel = `${meta.id.replace(/\//g, "_")}.md`
	mkdirSync(FIXTURES, { recursive: true })
	writeFileSync(join(FIXTURES, fixtureRel), generateTestStub(meta), "utf8")
	console.log(`✓ wrote bring-a-test stub kbit-fixtures/${fixtureRel}`)
}

async function cmdEdit(id: string): Promise<void> {
	const entry = readCatalog().find((e) => e.id === id)
	if (!entry) {
		console.error(`unknown bit id "${id}". Try \`kbit ls\`.`)
		process.exitCode = 1
		return
	}
	const full = join(KB, entry.path)
	const fm = extractFrontmatter(readFileSync(full, "utf8"))
	const cur = yamlLoad(fm.yaml) as Partial<KBitMeta>

	const rl = readline.createInterface({ input: stdin, output: stdout })
	try {
		const meta = await promptMeta(rl, entry.path, cur)
		if ((await ask(rl, "add an endorser? (y/N)", "N")).toLowerCase().startsWith("y")) {
			const handle = await ask(rl, "  endorser handle")
			const endorser = {
				handle,
				name: (await ask(rl, "  name (optional)")) || undefined,
				affiliation: (await ask(rl, "  affiliation (optional)")) || undefined,
				version: await ask(rl, "  endorses which version", meta.version),
				date: await ask(rl, "  date", today()),
				verified: false,
			}
			meta.endorsers = [...(meta.endorsers ?? []), endorser]
		}
		// Re-validate (catches self-endorsement) and rewrite frontmatter; PRESERVE the body verbatim.
		const newFile = `${generateFrontmatter(meta)}\n${fm.body.replace(/^\n+/, "")}`
		writeFileSync(full, newFile, "utf8")
		console.log(`\n✓ updated ${entry.path}`)
		finishAuthoring(entry.path)
	} finally {
		rl.close()
	}
}

/** Lint the just-written bit and regenerate the manifest. */
function finishAuthoring(relPath: string): void {
	const knownIds = new Set(listBitFiles(KB).map(deriveId))
	const issues = lintBitContent(relPath, readFileSync(join(KB, relPath), "utf8"), knownIds)
	for (const i of issues) {
		console.log(`  [${i.level}] ${i.msg}`)
	}
	if (issues.some((i) => i.level === "error")) {
		console.error("✗ the bit has lint errors — fix them, then run `npm run gen:kbit-manifest`.")
		process.exitCode = 1
		return
	}
	execSync("npm run gen:kbit-manifest", { cwd: REPO, stdio: "inherit" })
}

// ── dispatch ─────────────────────────────────────────────────────────────────────

/** `kbit stats [id]` — per-bit registry fetch counts from the live registry (distributions, not raw uses). */
async function cmdStats(args: string[]): Promise<void> {
	const base = process.env.ADSUM_API_BASE_URL || "https://api.adsumnetworks.com"
	const filter = args[0]
	let bits: Array<{ id: string; fetch_count: number; last_fetched_at: string | null }>
	try {
		const res = await fetch(`${base}/v1/kbits/stats`)
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`)
		}
		bits = ((await res.json()) as { bits?: typeof bits }).bits ?? []
	} catch (e) {
		console.error(`Could not fetch stats from ${base}: ${e instanceof Error ? e.message : e}`)
		process.exitCode = 1
		return
	}
	if (filter) {
		bits = bits.filter((b) => b.id === filter || b.id.includes(filter))
	}
	if (bits.length === 0) {
		console.log(filter ? `No stats for "${filter}".` : "No usage recorded yet.")
		return
	}
	const w = Math.max(3, ...bits.map((b) => b.id.length))
	console.log(`${"id".padEnd(w)}  fetches  last fetched`)
	for (const b of bits) {
		const last = b.last_fetched_at ? new Date(b.last_fetched_at).toISOString().slice(0, 10) : "—"
		console.log(`${b.id.padEnd(w)}  ${String(b.fetch_count).padStart(7)}  ${last}`)
	}
	console.log(`\n${bits.length} bit(s) · ${base} · fetches = registry distributions (cached after first fetch), not raw uses`)
}

async function main(): Promise<void> {
	const [cmd, ...rest] = process.argv.slice(2)
	switch (cmd) {
		case "ls":
			cmdLs(rest)
			break
		case "tree":
			cmdTree()
			break
		case "show":
			cmdShow(rest[0])
			break
		case "lint":
			cmdLint()
			break
		case "new":
			await cmdNew(rest)
			break
		case "edit":
			await cmdEdit(rest[0])
			break
		case "stats":
			await cmdStats(rest)
			break
		default:
			console.log("usage: kbit <ls|tree|show <id>|lint|new|edit <id>|stats [id]>")
			process.exitCode = cmd ? 1 : 0
	}
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e)
	process.exitCode = 1
})
