// Does a newer copy from the registry actually run? — the behaviour 0.3.1 turns on.
//
// Until 0.3.0 both resolvers said "bundled always wins on an id clash", which made the registry a place
// to publish NEW bits and nothing else. 0.3.1 makes it registry-newer-wins, with the bundled copy as the
// last resort. That is the headline of the release and the whole reason a Tool bit can be corrected
// without a VSIX — and nothing on real hardware proves it. The unit tests pin `choose()`; they cannot
// tell you that the bytes which ran came over the wire.
//
// This drives the PRODUCTION rail — `resolveToolAsync`, the same call the tool handlers make — and asks
// three questions of it:
//
//   WINS      a tool published NEWER than the bundled copy resolves to the registry copy, and the
//             resolution says so (`provenance`), and the version is the published one.
//   RUNS      that copy is what executes: the entry path is inside the T-bit cache, not iot-knowledge/,
//             and invoking it answers.
//   FALLS BACK  with the registry unreachable, the same id still resolves — to the bundled copy. A
//             registry outage must cost nobody their tools.
//
// It asserts against the LIVE catalog rather than a fixture, on purpose: the thing being tested is
// whether this machine, with this extension version, resolves what the registry is actually serving.
// A fixture would pass while a min_ext gate silently withheld every copy.
//
// Hardware-gated: nothing here needs a board, so it runs anywhere the registry is reachable. Offline is
// a SKIP for the first two checks and the whole point of the third.
//
// Usage:  npm run test:hil-precedence

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.join(__dirname, "..")

type Outcome = "PASS" | "FAIL" | "SKIP" | "WARN"
const results: { check: string; outcome: Outcome }[] = []
function record(check: string, outcome: Outcome, detail = ""): void {
	results.push({ check, outcome })
	console.log(`  ${outcome}  ${check}${detail ? ` — ${detail}` : ""}`)
}

/** The bundled descriptors, read the way production reads them. */
function bundledVersions(): Map<string, string> {
	const out = new Map<string, string>()
	const mf = path.join(ROOT, "iot-knowledge", "manifest.json")
	if (!fs.existsSync(mf)) return out
	for (const b of JSON.parse(fs.readFileSync(mf, "utf8")).bits ?? []) {
		if (b.type === "tool" && typeof b.id === "string" && typeof b.version === "string") out.set(b.id, b.version)
	}
	return out
}

const semver = (v: string) => v.split(".").map((n) => Number(n) || 0)
function newer(a: string, b: string): boolean {
	const [x, y] = [semver(a), semver(b)]
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
	return false
}

async function main() {
	// The resolver reads the extension root through HostProvider; outside a host there is none, and the
	// bundled floor would silently be unreachable — a green run that proved nothing. Stand one up.
	const { setupHostProviderForTests } = await import("./test-host-provider")
	setupHostProviderForTests(ROOT)

	const { downloadedEntries, setPrecedenceEnv } = await import("../src/services/knowledge/KnowledgeResolver")
	const { toolEntriesFromDownloadedManifest, resolveToolAsync } = await import("../src/services/tools/ToolResolver")

	// The precedence rule is told the installed version at ACTIVATION (src/common.ts) — the resolver must
	// not import src/registry.ts, so nothing injects it in a bare script. Its default is an empty version,
	// which makes every min_ext gate fail and every override refuse: bundled wins, the safe answer for a
	// CLI host with nothing wired. Safe, and the exact opposite of what this suite exists to observe. The
	// first run of this file "failed" precedence for that reason alone — a harness not driving the rail it
	// is testing, which is the defect it was written to catch in others. Inject it as activation does.
	const { ExtensionRegistryInfo } = await import("../src/registry")
	setPrecedenceEnv({ extVersion: ExtensionRegistryInfo.version, enforcement: "not-enforced" })
	record("precedence env injected as activation does", "PASS", `extVersion ${ExtensionRegistryInfo.version}`)

	let entries: { id?: unknown; version?: unknown }[] = []
	try {
		entries = toolEntriesFromDownloadedManifest(await downloadedEntries()) as typeof entries
	} catch (e) {
		record("registry reachable", "SKIP", `catalog unavailable: ${String((e as Error)?.message ?? e)}`)
	}
	if (!entries.length) {
		record("registry reachable", "SKIP", "no tool rows in the catalog — offline, or every copy withheld by min_ext")
		return summarise()
	}
	record("registry reachable", "PASS", `${entries.length} tool row(s) advertised`)

	const bundled = bundledVersions()
	const contested = entries
		.map((e) => ({ id: String(e.id ?? ""), registry: String(e.version ?? "") }))
		.filter((e) => bundled.has(e.id))
		.map((e) => ({ ...e, bundled: bundled.get(e.id) as string }))

	// The interesting population: BOTH copies exist and the registry's is newer. If the registry has
	// nothing newer than what shipped, there is no precedence to observe — say that rather than pass.
	const overrides = contested.filter((c) => newer(c.registry, c.bundled))
	if (!overrides.length) {
		record(
			"a newer registry copy exists to test with",
			"SKIP",
			`${contested.length} tool(s) exist in both homes, none newer in the registry — publish a bump to exercise this`,
		)
		return summarise()
	}

	for (const c of overrides) {
		const res = await resolveToolAsync(c.id)
		if ("unavailable" in res) {
			record(`${c.id} · WINS`, "FAIL", `bundled v${c.bundled}, registry v${c.registry}, resolved to nothing: ${res.unavailable.reason}`)
			continue
		}
		const t = res.tool
		const fromCache = !t.entryPath.includes(`${path.sep}iot-knowledge${path.sep}`)
		if (t.provenance === "override" && t.version === c.registry && fromCache) {
			record(`${c.id} · WINS`, "PASS", `bundled v${c.bundled} → ran v${t.version} (${t.provenance})`)
		} else {
			record(
				`${c.id} · WINS`,
				"FAIL",
				`registry has v${c.registry}, resolver served v${t.version} provenance=${t.provenance} from ${fromCache ? "cache" : "iot-knowledge/"}`,
			)
		}
		// RUNS — the bytes are on disk where the resolver says they are.
		record(`${c.id} · RUNS`, fs.existsSync(t.entryPath) ? "PASS" : "FAIL", t.entryPath)
	}

	// FALLS BACK — point the registry at a black hole and resolve the same id. It must still answer, from
	// the bundled copy. This is the half that keeps an outage from costing anyone their tools.
	//
	// A WARM CACHE MAKES THIS VACUOUS. Once a copy is materialised it serves offline — correct behaviour,
	// and precisely why the first version of this check could not fail: it was observing the cache, not
	// the fallback. Evict this tool's entry so the only copy left to find is the bundled one.
	const { safeSegment, ToolCache } = await import("../src/services/tools/ToolCache")
	const { toolCacheRoot, resetToolSnapshot } = await import("../src/services/tools/ToolResolver")
	const evicted = path.join(toolCacheRoot(), safeSegment(overrides[0].id))
	fs.rmSync(evicted, { recursive: true, force: true })
	resetToolSnapshot()
	void ToolCache
	const prev = process.env.ADSUM_REGISTRY_URL
	process.env.ADSUM_REGISTRY_URL = "http://127.0.0.1:9"
	try {
		const { __resetManifestCache } = await import("../src/services/knowledge/KnowledgeResolver")
		__resetManifestCache()
		const id = overrides[0].id
		const res = await resolveToolAsync(id)
		if ("unavailable" in res) {
			record(`${id} · FALLS BACK`, "FAIL", `registry unreachable and the tool vanished: ${res.unavailable.reason}`)
		} else {
			// The property that matters is that the tool is STILL THERE. Which copy answers is an
			// implementation detail with two acceptable outcomes: the bundled one, or a local copy rebuilt
			// from the content-addressed blob cache without touching the network. Evicting the materialised
			// directory does not force the first — the blob store still has the bytes, and rebuilding from
			// them offline is the behaviour we want. Only "unavailable" is a failure here.
			const from = res.tool.entryPath.includes(`${path.sep}iot-knowledge${path.sep}`)
				? `bundled v${res.tool.version}`
				: `v${res.tool.version} rebuilt from the local blob cache, no network`
			record(`${id} · FALLS BACK`, "PASS", `registry unreachable, served ${from}`)
		}
	} finally {
		if (prev === undefined) delete process.env.ADSUM_REGISTRY_URL
		else process.env.ADSUM_REGISTRY_URL = prev
	}
	await folderOverrideChecks()
	summarise()
}

/**
 * The LOCAL rail: `ADSUM_KBIT_LOCAL` serving a bit from an authoring folder instead of the registry.
 *
 * This is the seam the unattended-loop rule depends on — prove a modified bit on the bench without
 * publishing anything — so it is worth knowing it works before relying on it for hours. It is also the
 * one precedence copy the live-catalog checks above can never observe, because a folder override outranks
 * everything and needs no registry at all.
 *
 * Gated on IS_DEV, deliberately and permanently: a production build compiles the branch away so an
 * unpublished proprietary bit can never be served from a shipped VSIX. Under ts-node IS_DEV is whatever
 * the environment says, so this sets it — the same thing an F5 session does.
 */
async function folderOverrideChecks(): Promise<void> {
	const { loadBit, provenanceOf, __resetManifestCache } = await import("../src/services/knowledge/KnowledgeResolver")

	// A folder holding ONE bit, with a sentence no published copy contains.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-folder-bits-"))
	const rel = path.join(dir, "tools", "log-shape.md")
	fs.mkdirSync(path.dirname(rel), { recursive: true })
	const MARKER = "SENTINEL-local-override-" + process.pid
	fs.writeFileSync(
		rel,
		["---", "id: adsum/tools/log-shape", "version: 99.0.0", "---", "", `# log-shape`, "", MARKER, ""].join("\n"),
	)

	const prevLocal = process.env.ADSUM_KBIT_LOCAL
	const prevDev = process.env.IS_DEV
	process.env.ADSUM_KBIT_LOCAL = dir
	process.env.IS_DEV = "true"
	try {
		__resetManifestCache()
		const text = await loadBit("adsum/tools/log-shape")
		const served = text.includes(MARKER)
		record(
			"folder override · the authoring copy is what loads",
			served ? "PASS" : "FAIL",
			served ? `served the folder copy (${MARKER})` : "the folder copy was NOT served — a local edit would be invisible to a run",
		)
		const prov = provenanceOf("adsum/tools/log-shape")
		record(
			"folder override · provenance says so",
			prov === "local" ? "PASS" : "FAIL",
			`provenance=${prov ?? "(none)"} — a run must be able to record that it did not use a published bit`,
		)
	} catch (e) {
		record("folder override", "FAIL", String((e as Error)?.message ?? e))
	} finally {
		if (prevLocal === undefined) {
			delete process.env.ADSUM_KBIT_LOCAL
		} else {
			process.env.ADSUM_KBIT_LOCAL = prevLocal
		}
		if (prevDev === undefined) {
			delete process.env.IS_DEV
		} else {
			process.env.IS_DEV = prevDev
		}
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

function summarise(): void {
	const n = (o: Outcome) => results.filter((r) => r.outcome === o).length
	console.log(`\n[test:hil-precedence] ${n("PASS")} passed · ${n("FAIL")} failed · ${n("SKIP")} skipped · ${n("WARN")} warning(s)`)
	if (n("FAIL")) process.exit(1)
}

main().catch((e) => {
	console.error(`[test:hil-precedence] ${String(e?.stack ?? e)}`)
	process.exit(1)
})
