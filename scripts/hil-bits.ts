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
		.map((b: any) => ({ id: b.id, type: b.type, version: String(b.version), path: b.path, abs: path.join(KNOWLEDGE, b.path) }))
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
		.map((l) => l.replace(/^[ \t]*-[ \t]*/, "").trim().replace(/^["']|["']$/g, ""))
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
		record(bit.id, "REQUIRES", dangling.length ? "FAIL" : "PASS", dangling.length ? `unresolvable: ${dangling.join(", ")}` : "")

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
			record(bit.id, "HOST-SHAPE", bad.length ? "FAIL" : "PASS", bad.length ? `a host tool must declare no ${bad.join(" and no ")}` : "")
			continue
		}
		record(bit.id, "ENTRY", entry && fs.existsSync(path.join(dir, entry)) ? "PASS" : "FAIL", entry ? `${entry} is not on disk` : "no entry declared")

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

	const n = (o: Outcome) => results.filter((r) => r.outcome === o).length
	const failed = results.filter((r) => r.outcome === "FAIL")
	if (failed.length) {
		console.log(`\nfailing bits:\n${[...new Set(failed.map((f) => `  ${f.bit} (${f.check})`))].join("\n")}`)
	}
	console.log(
		`\n[test:hil-bits] ${n("PASS")} passed · ${n("FAIL")} failed · ${n("SKIP")} skipped · ${n("WARN")} warning(s) over ${bits.length} bit(s)`,
	)
	if (n("FAIL")) {
		process.exit(1)
	}
}

main().catch((e) => {
	console.error(`[test:hil-bits] ${String((e as Error)?.stack ?? e)}`)
	process.exit(1)
})
