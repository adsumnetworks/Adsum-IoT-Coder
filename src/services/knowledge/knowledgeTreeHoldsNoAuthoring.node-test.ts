/**
 * The shipped knowledge tree holds knowledge, and nothing written for the people who author it.
 *
 * The agent can list and search `iot-knowledge/` inside the installed extension. On 14 September a
 * developer asked which chip was which on their board; the agent searched that folder for the product
 * name, and the authoring specification answered — its line on access groups put group names and
 * "entitlement" into the developer's session, and the agent went on to talk about "gated" bits. The
 * specification had moved nothing on disk; it had simply been left beside the bits.
 *
 * So these assertions are about what an agent can reach, not about what a file is called:
 *   1. every Markdown file in the tree is a bit (it opens with front matter) — a Markdown file that is
 *      not a bit is somebody's notes, and notes are what leaked;
 *   2. no file in the tree is named like an authoring document or schema;
 *   3. no file in the tree carries an access-group name — bundled means open, so a group name in the
 *      shipped tree can only be authoring vocabulary;
 *   4. the authoring documents exist where they moved to, and that folder is kept out of the package.
 */

import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { KBIT_GROUPS } from "./kbit/schema"

const ROOT = path.resolve(__dirname, "..", "..", "..")
const TREE = path.join(ROOT, "iot-knowledge")
const AUTHORING = path.join(ROOT, "kbit-authoring")

function walk(dir: string): string[] {
	const out: string[] = []
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name)
		if (name === "__pycache__") continue
		if (statSync(full).isDirectory()) out.push(...walk(full))
		else out.push(full)
	}
	return out
}
const rel = (p: string) => path.relative(ROOT, p)

/** Names that say "this is for authors": specs, schemas, templates, style guides, contributor notes. */
const AUTHORING_NAME = /(^|[-_.])(spec|schema|template|authoring|contributing|style-?guide|readme|notes|todo|changelog)([-_.]|$)/i

/** The tree's non-bit files that ARE for the running product, each with its reason. */
const ALLOWED_NON_BITS = new Set([
	"iot-knowledge/manifest.json", // the runtime index of the bundled bits
	"iot-knowledge/LICENSE", // the licence the bundled bits ship under
])

describe("the shipped knowledge tree holds no authoring material", () => {
	const files = walk(TREE)

	test("the tree is found and is not empty", () => {
		assert.ok(files.length > 20, `expected the bundled bits under ${TREE}, found ${files.length} files`)
	})

	test("every Markdown file in the tree is a bit", () => {
		const notBits = files.filter((f) => f.endsWith(".md") && !readFileSync(f, "utf8").startsWith("---\n"))
		assert.deepEqual(notBits.map(rel), [], "a Markdown file without front matter is not a bit — move it to kbit-authoring/")
	})

	test("no file in the tree is named like an authoring document", () => {
		const named = files
			.map(rel)
			.filter((r) => !ALLOWED_NON_BITS.has(r))
			.filter((r) => AUTHORING_NAME.test(path.basename(r).replace(/\.[^.]+$/, "")))
		assert.deepEqual(named, [], "authoring documents belong in kbit-authoring/, outside the shipped tree")
	})

	test("no file in the tree names an access group", () => {
		const hits: string[] = []
		for (const f of files) {
			const text = readFileSync(f).toString("latin1")
			for (const g of KBIT_GROUPS) {
				if (g.length >= 6 && new RegExp(`(^|[^a-z0-9-])${g.replace(/[-]/g, "\\-")}([^a-z0-9-]|$)`).test(text)) {
					hits.push(`${rel(f)}: ${g}`)
				}
			}
		}
		assert.deepEqual(hits, [], "a group name in the shipped tree is authoring vocabulary an agent can repeat to a developer")
	})

	test("no bit uses the internal word for its self-test heading (B10)", () => {
		// 14 Sep 2026: an agent told a developer "the built-in falsifier for this rule", read off a `## Falsifier`
		// heading. The developer's words are "How to tell it failed".
		const hits = files.filter((f) => f.endsWith(".md") && /\bfalsifier\b/i.test(readFileSync(f, "utf8"))).map(rel)
		assert.deepEqual(hits, [])
	})

	test("no bit carries a dated authoring tag such as [BENCH 2026-09-04] (B13)", () => {
		// 14 Sep 2026: tags like these in always-loaded bits taught the agent to call a developer's desk "the bench".
		const hits = files
			.filter((f) => f.endsWith(".md") && /\[\s*(BENCH|FIELD|OPERATOR)\b/.test(readFileSync(f, "utf8")))
			.map(rel)
		assert.deepEqual(hits, [])
	})

	test("the authoring documents live outside the tree, and that folder is not packaged", () => {
		assert.ok(existsSync(path.join(AUTHORING, "KBIT-SPEC.md")), "kbit-authoring/KBIT-SPEC.md")
		assert.ok(existsSync(path.join(AUTHORING, "kbit.schema.json")), "kbit-authoring/kbit.schema.json")
		const ignore = readFileSync(path.join(ROOT, ".vscodeignore"), "utf8")
			.split("\n")
			.map((l) => l.trim())
		assert.ok(ignore.includes("kbit-authoring/**"), ".vscodeignore must exclude kbit-authoring/** from the package")
	})
})
