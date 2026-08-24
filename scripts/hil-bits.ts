// Every bit in the corpus, validated WITHOUT inference.
//
// The 0.3.1 pass changed 23 bit files: the device tools became Tool bits, two reference catalogues moved
// out of code, the built-in doors got descriptors, and precedence changed which copy runs. What existed
// to check that was a schema lint (is the frontmatter well-formed) and a HIL suite for the tool bits that
// can actually be spawned. Neither answers the question a developer's session asks first:
//
//     can the agent LOAD this bit, through the resolver production uses, and is what it gets coherent?
//
// This suite answers it for every bit, deterministically — no model, no provider, no tokens. That matters
// beyond cost: a model-driven run tells you a scenario passed, not which of thirty bits were sound. Run
// this first and a HIL failure afterwards is about behaviour, not about a bit that never loaded.
//
// Per bit:
//   LOADS        resolves through loadBit() and returns a non-empty body
//   FRONTMATTER  stripped from what the agent sees — a bit that leaks its own YAML wastes context and
//                invites the model to quote metadata back as if it were knowledge
//   REQUIRES     every declared `requires:` id exists in the corpus (a dangling one is a silent gap:
//                the loader pulls nothing and the agent proceeds without knowledge it was promised)
//   CREDIT       an author is attributable — the whole point of the byline
//
// Per TOOL bit additionally:
//   ENTRY        the declared entry is on disk (production's Rule 1: no entry, not a tool)
//   HASH         every declared artifact matches its sha256 — a descriptor lying about its own bytes
//                blocks publishing and, for a downloaded copy, fails verification at the door
//   HOST-SHAPE   a `runtime: host` descriptor names no entry and no artifact; there is nothing to spawn
//
// Usage:  npm run test:hil-bits

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { setupHostProviderForTests } from "./test-host-provider"

const ROOT = path.join(__dirname, "..")
const KNOWLEDGE = path.join(ROOT, "iot-knowledge")

type Outcome = "PASS" | "FAIL" | "SKIP" | "WARN"
const results: { bit: string; check: string; outcome: Outcome }[] = []
function record(bit: string, check: string, outcome: Outcome, detail = ""): void {
	results.push({ bit, check, outcome })
	if (outcome !== "PASS") {
		console.log(`  ${outcome}  ${bit} · ${check}${detail ? ` — ${detail}` : ""}`)
	}
}

interface Bit {
	id: string
	type: string
	version: string
	path: string
	abs: string
}

function corpus(): Bit[] {
	const mf = path.join(KNOWLEDGE, "manifest.json")
	const bits = JSON.parse(fs.readFileSync(mf, "utf8")).bits ?? []
	return bits
		.filter((b: any) => typeof b.id === "string" && typeof b.path === "string")
		.map((b: any) => ({
			id: b.id,
			type: b.type,
			version: String(b.version),
			path: b.path,
			abs: path.join(KNOWLEDGE, b.path),
		}))
}

const frontmatterOf = (text: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ""
const scalar = (fm: string, key: string): string | undefined =>
	fm
		.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"))?.[1]
		?.trim()
		.replace(/^["']|["']$/g, "")

/** `requires:` as a list, in both YAML shapes the corpus uses (inline array and block sequence). */
function requiresOf(fm: string): string[] {
	const inline = /^requires:\s*\[(.*?)\]/m.exec(fm)?.[1]
	if (inline) {
		return inline
			.split(",")
			.map((x) => x.trim().replace(/^["']|["']$/g, ""))
			.filter(Boolean)
	}
	const block = /^requires:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m.exec(fm)?.[1]
	if (!block) {
		return []
	}
	return block
		.split("\n")
		.map((l) =>
			l
				.replace(/^[ \t]*-[ \t]*/, "")
				.trim()
				.replace(/^["']|["']$/g, ""),
		)
		.filter(Boolean)
}

async function main(): Promise<void> {
	setupHostProviderForTests(ROOT)
	const { loadBit } = await import("../src/services/knowledge/KnowledgeResolver")

	const bits = corpus()
	const ids = new Set(bits.map((b) => b.id))
	console.log(`[test:hil-bits] ${bits.length} bit(s) in the bundled corpus — loading each through the production resolver\n`)

	for (const bit of bits) {
		const raw = fs.existsSync(bit.abs) ? fs.readFileSync(bit.abs, "utf8") : ""
		if (!raw) {
			record(bit.id, "LOADS", "FAIL", `${bit.path} is not on disk — the manifest names a file that is not there`)
			continue
		}
		const fm = frontmatterOf(raw)

		// LOADS — through the resolver, not by reading the file ourselves.
		let body = ""
		try {
			body = await loadBit(bit.id)
		} catch (e) {
			record(bit.id, "LOADS", "FAIL", String((e as Error)?.message ?? e))
		}
		const isHostTool = bit.type === "tool" && scalar(fm, "runtime") === "host"
		if (body.trim().length > 0) {
			record(bit.id, "LOADS", "PASS")
		} else {
			// A host-tool descriptor is metadata with no prose to serve; an empty body is its normal state.
			record(bit.id, "LOADS", isHostTool ? "PASS" : "FAIL", isHostTool ? "" : "resolved to an empty body")
		}

		// FRONTMATTER — the agent must never be handed the YAML.
		record(
			bit.id,
			"FRONTMATTER",
			body.includes("\nid: " + bit.id) || /^---\s*\n/.test(body) ? "FAIL" : "PASS",
			"the body still carries its frontmatter",
		)

		// REQUIRES — every declared dependency exists.
		const dangling = requiresOf(fm).filter((r) => !ids.has(r))
		record(
			bit.id,
			"REQUIRES",
			dangling.length ? "FAIL" : "PASS",
			dangling.length ? `unresolvable: ${dangling.join(", ")}` : "",
		)

		// CREDIT — somebody is named.
		const author = scalar(fm, "author")
		record(bit.id, "CREDIT", author ? "PASS" : "FAIL", author ? "" : "no author — the byline is the point")

		if (bit.type !== "tool") {
			continue
		}
		const dir = path.dirname(bit.abs)
		const entry = scalar(fm, "entry")
		if (isHostTool) {
			// HOST-SHAPE — nothing to spawn, so nothing may be declared as spawnable.
			const bad = [entry ? "entry" : null, /^artifacts:/m.test(fm) ? "artifacts" : null].filter(Boolean)
			record(
				bit.id,
				"HOST-SHAPE",
				bad.length ? "FAIL" : "PASS",
				bad.length ? `a host tool must declare no ${bad.join(" and no ")}` : "",
			)
			continue
		}
		record(
			bit.id,
			"ENTRY",
			entry && fs.existsSync(path.join(dir, entry)) ? "PASS" : "FAIL",
			entry ? `${entry} is not on disk` : "no entry declared",
		)

		// HASH — the descriptor must not lie about its own bytes.
		const declared = [...fm.matchAll(/^\s*-\s*path:\s*(\S+)\s*\n\s*sha256:\s*([0-9a-f]{64})/gm)]
		if (!declared.length) {
			record(bit.id, "HASH", "WARN", "no artifacts[] with sha256 — nothing to verify")
		} else {
			const wrong: string[] = []
			for (const [, rel, want] of declared) {
				const f = path.join(dir, rel)
				if (!fs.existsSync(f)) {
					wrong.push(`${rel} missing`)
					continue
				}
				const got = createHash("sha256").update(fs.readFileSync(f)).digest("hex")
				if (got !== want) {
					wrong.push(`${rel} says ${want.slice(0, 12)}… is ${got.slice(0, 12)}…`)
				}
			}
			record(bit.id, "HASH", wrong.length ? "FAIL" : "PASS", wrong.join("; "))
		}
	}

	const registryCount = await registryChecks(ids)
	const folderCount = folderChecks(ids)

	const n = (o: Outcome) => results.filter((r) => r.outcome === o).length
	const failed = results.filter((r) => r.outcome === "FAIL")
	if (failed.length) {
		console.log(`\nfailing bits:\n${[...new Set(failed.map((f) => `  ${f.bit} (${f.check})`))].join("\n")}`)
	}
	console.log(
		`\n[test:hil-bits] ${n("PASS")} passed · ${n("FAIL")} failed · ${n("SKIP")} skipped · ${n("WARN")} warning(s) ` +
			`over ${bits.length} bundled bit(s)${registryCount ? ` + ${registryCount} advertised by the registry` : " (registry not reached)"}` +
			`${folderCount ? ` + ${folderCount} in the authoring folder` : ""}`,
	)
	if (n("FAIL")) {
		process.exit(1)
	}
}

/**
 * The bits nobody checks yet: the AUTHORING FOLDER.
 *
 * A bit is drafted in Adsum-Backend/kbits, then published, and only then does anything look at it — the
 * bundled pass reads the VSIX manifest and the registry pass reads what the catalog advertises. So the one
 * moment when a mistake is cheapest to fix, before it is served to anyone, is the one moment nothing is
 * looking. That is backwards, and it matters more now that drafts deliberately sit unpublished waiting for
 * an operator to approve them.
 *
 * This pass reads the folder directly and applies the checks that do not need a resolver: an id, a version,
 * a named author, no dangling `requires:`, and a body that is more than its own frontmatter. It cannot
 * check LOADS — an unpublished bit has no resolver entry, which is the point of it being unpublished — so
 * it does not pretend to. Silent when the folder is absent, so a machine without the sibling checkout is
 * not failed for it.
 */
function folderChecks(knownIds: Set<string>): number {
	const root = path.join(ROOT, "..", "Adsum-Backend", "kbits")
	if (!fs.existsSync(root)) {
		return 0
	}
	const files: string[] = []
	const walk = (dir: string): void => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, e.name)
			if (e.isDirectory()) {
				walk(full)
			} else if (e.name.endsWith(".md")) {
				files.push(full)
			}
		}
	}
	walk(root)
	if (files.length === 0) {
		return 0
	}
	console.log(`\n[test:hil-bits] ${files.length} bit(s) in the authoring folder — checked before anything publishes them\n`)

	// Every id the folder itself declares counts as resolvable: a draft may legitimately require a sibling
	// draft that no registry has heard of yet.
	const folderIds = new Set<string>()
	const parsed: { rel: string; fm: string; body: string }[] = []
	for (const abs of files) {
		const raw = fs.readFileSync(abs, "utf8")
		const fm = frontmatterOf(raw)
		const id = scalar(fm, "id")
		if (id) {
			folderIds.add(id)
		}
		parsed.push({ rel: path.relative(root, abs), fm, body: raw.slice(raw.indexOf("---", 3) + 3) })
	}

	for (const { rel, fm, body } of parsed) {
		const id = scalar(fm, "id") ?? `folder:${rel}`
		record(id, "FOLDER-ID", scalar(fm, "id") ? "PASS" : "FAIL", `${rel} declares no id`)
		record(id, "FOLDER-VERSION", scalar(fm, "version") ? "PASS" : "FAIL", `${rel} declares no version`)
		record(id, "FOLDER-CREDIT", scalar(fm, "author") ? "PASS" : "FAIL", `${rel} names no author — the byline is the point`)
		record(id, "FOLDER-BODY", body.trim().length > 0 ? "PASS" : "FAIL", `${rel} is frontmatter with nothing under it`)
		const dangling = requiresOf(fm).filter((r) => !knownIds.has(r) && !folderIds.has(r))
		record(
			id,
			"FOLDER-REQUIRES",
			dangling.length ? "FAIL" : "PASS",
			dangling.length ? `unresolvable: ${dangling.join(", ")}` : "",
		)
	}
	return files.length
}

/**
 * The bits that are NOT in the VSIX — everything the registry serves.
 *
 * Three times as many bits live there as ship bundled, and nothing checks them: the corpus lint reads the
 * repo, and `hil-tools` covers the download rail for TOOL bits only. A knowledge bit published with a
 * dangling `requires:` or an unreachable body is a gap nobody sees until a session needs it and the agent
 * quietly proceeds without knowledge it was promised.
 *
 * Fetches through the same client the extension uses, so a bit that cannot be fetched here cannot be
 * fetched by a developer either. Needs the network; SKIPs, loudly, without it.
 */
async function registryChecks(bundledIds: Set<string>): Promise<number> {
	const { downloadedEntries, loadBit, setPrecedenceEnv } = await import("../src/services/knowledge/KnowledgeResolver")
	const { ExtensionRegistryInfo } = await import("../src/registry")
	// Same injection activation does — without it every min_ext gate compares against "" and the registry
	// copies are all withheld, which would look like a clean run over an empty set.
	setPrecedenceEnv({ extVersion: ExtensionRegistryInfo.version, enforcement: "not-enforced" })

	let rows: Record<string, unknown>[] = []
	try {
		rows = (await downloadedEntries()) as Record<string, unknown>[]
	} catch (e) {
		record("registry", "REACHABLE", "SKIP", String((e as Error)?.message ?? e))
		return 0
	}
	const advertised = rows.filter((r) => typeof r.id === "string")
	if (!advertised.length) {
		record("registry", "REACHABLE", "SKIP", "the catalog advertises nothing for this extension version")
		return 0
	}
	const ids = new Set(advertised.map((r) => String(r.id)))
	console.log(
		`\n[test:hil-bits] ${advertised.length} bit(s) advertised by the registry for v${ExtensionRegistryInfo.version}\n`,
	)

	for (const row of advertised) {
		const id = String(row.id)
		// A tool bit's body is a descriptor; hil-tools drives those. Here: the knowledge the agent reads.
		if (String(row.type ?? "") === "tool") {
			continue
		}
		let body = ""
		try {
			body = await loadBit(id)
		} catch (e) {
			record(id, "FETCHES", "FAIL", String((e as Error)?.message ?? e))
			continue
		}
		if (!body.trim()) {
			// Bundled-and-newer is a legitimate reason to serve nothing new; anything else is a hole.
			record(id, "FETCHES", bundledIds.has(id) ? "PASS" : "FAIL", bundledIds.has(id) ? "" : "empty body from the registry")
			continue
		}
		record(id, "FETCHES", "PASS")
		record(id, "FRONTMATTER", /^---\s*\n/.test(body) ? "FAIL" : "PASS", "the served body carries its frontmatter")
		const declared = requiresOf(frontmatterOf(body) || "")
		const dangling = declared.filter((r) => !ids.has(r) && !bundledIds.has(r))
		record(id, "REQUIRES", dangling.length ? "FAIL" : "PASS", dangling.length ? `unresolvable: ${dangling.join(", ")}` : "")
	}
	return advertised.length
}

main().catch((e) => {
	console.error(`[test:hil-bits] ${String((e as Error)?.stack ?? e)}`)
	process.exit(1)
})
