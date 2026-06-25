import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"
import { indexManifest } from "../KnowledgeResolver"
import { composeBit, generateBody, generateFrontmatter } from "./authoring"
import { extractFrontmatter, stripFrontmatter } from "./frontmatter"
import { buildTree, filterEntries, formatBitDetail, formatCatalog, type ManifestEntry } from "./inspect"
import {
	deriveId,
	detectSafety,
	type Issue,
	lintBitContent,
	lintCorpus,
	lintManifestFresh,
	lintVersionBump,
	listBitFiles,
	parseManifestEntries,
} from "./lint"
import { kbitMetaSchema } from "./schema"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const KNOWLEDGE_ROOT = join(REPO_ROOT, "iot-knowledge")

const ok = (o: Record<string, unknown>) => kbitMetaSchema.safeParse(o).success
const omit = (o: Record<string, unknown>, key: string): Record<string, unknown> => {
	const copy = { ...o }
	delete copy[key]
	return copy
}

const validWorkflow: Record<string, unknown> = {
	id: "adsum/nrf/workflows/add-feature",
	title: "Add Feature",
	type: "workflow",
	version: "1.0.0",
	owner: "adsum-core",
	author: "adsum",
	license: "CC-BY-SA-4.0",
	tier: "certified",
	delivery: "bundled",
	domain: "embedded-iot",
	platform: "nrf",
	triggers: ["add a feature"],
}
const validAction: Record<string, unknown> = {
	id: "adsum/nrf/actions/flash",
	title: "Flash",
	type: "action",
	version: "1.0.0",
	owner: "adsum-core",
	author: "adsum",
	license: "CC-BY-SA-4.0",
	tier: "certified",
	delivery: "bundled",
	domain: "embedded-iot",
	platform: "nrf",
}

// ---------------------------------------------------------------- schema

describe("kbit schema", () => {
	test("valid workflow / action / universal knowledge pass", () => {
		assert.equal(ok(validWorkflow), true)
		assert.equal(ok(validAction), true)
		assert.equal(ok({ ...validAction, type: "knowledge", platform: "universal", id: "adsum/agent" }), true)
	})

	test("workflow must declare triggers", () => {
		assert.equal(ok(omit(validWorkflow, "triggers")), false)
		assert.equal(ok({ ...validWorkflow, triggers: [] }), false)
	})

	test("only workflows may declare triggers", () => {
		assert.equal(ok({ ...validAction, triggers: ["x"] }), false)
		assert.equal(ok({ ...validAction, type: "knowledge", triggers: ["x"] }), false)
	})

	test("version must be semver", () => {
		assert.equal(ok({ ...validWorkflow, version: "1.0" }), false)
		assert.equal(ok({ ...validWorkflow, version: "BAD" }), false)
	})

	test("min_ext (backward-compat gate) is optional + semver", () => {
		assert.equal(ok(validAction), true) // absent ⇒ universal (the default)
		assert.equal(ok({ ...validAction, min_ext: "0.1.7" }), true)
		assert.equal(ok({ ...validAction, min_ext: "0.1" }), false) // must be MAJOR.MINOR.PATCH
		assert.equal(ok({ ...validAction, min_ext: "latest" }), false)
	})

	test("enums are enforced (owner/tier/delivery/type/platform/safety)", () => {
		assert.equal(ok({ ...validAction, owner: "nope" }), false)
		assert.equal(ok({ ...validAction, tier: "gold" }), false)
		assert.equal(ok({ ...validAction, delivery: "magnet" }), false)
		assert.equal(ok({ ...validAction, type: "recipe" }), false)
		assert.equal(ok({ ...validAction, platform: "arduino" }), false)
		assert.equal(ok({ ...validAction, safety: ["nuke"] }), false)
		assert.equal(ok({ ...validAction, safety: ["flash", "erase"] }), true)
	})

	test("unknown extra fields are rejected (strict)", () => {
		assert.equal(ok({ ...validAction, bogus: true }), false)
	})

	test("id must be a namespaced slug", () => {
		assert.equal(ok({ ...validAction, id: "Bad Id!" }), false)
		assert.equal(ok({ ...validAction, id: "adsum/nrf/actions/flash" }), true)
	})

	test("last_verified must be {date:YYYY-MM-DD, env}", () => {
		assert.equal(ok({ ...validAction, last_verified: { date: "2026/01/01", env: "x" } }), false)
		assert.equal(ok({ ...validAction, last_verified: { date: "2026-01-01", env: "NCS 3.2.1" } }), true)
		assert.equal(ok({ ...validAction, last_verified: { date: "2026-01-01" } }), false)
	})

	test("required fields are required", () => {
		assert.equal(ok(omit(validAction, "title")), false)
	})
})

// ---------------------------------------------------------------- frontmatter / id / safety

describe("extractFrontmatter", () => {
	test("no leading --- → not found, body is whole text", () => {
		const fm = extractFrontmatter("# Title\n---\nbody divider")
		assert.equal(fm.found, false)
		assert.equal(fm.body, "# Title\n---\nbody divider")
	})

	test("leading block parsed; mid-file --- dividers stay in body", () => {
		const fm = extractFrontmatter("---\na: 1\n---\n# H\n\n---\nmore")
		assert.equal(fm.found, true)
		assert.equal(fm.closed, true)
		assert.equal(fm.yaml, "a: 1")
		assert.equal(fm.body, "# H\n\n---\nmore")
	})

	test("unclosed frontmatter → found but not closed", () => {
		const fm = extractFrontmatter("---\na: 1\nno closing")
		assert.equal(fm.found, true)
		assert.equal(fm.closed, false)
	})
})

describe("KnowledgeResolver.indexManifest", () => {
	test("builds an id→path map from manifest json", () => {
		const m = indexManifest(
			JSON.stringify({
				bits: [
					{ id: "adsum/x", path: "a/x.md" },
					{ id: "adsum/y", path: "b/y.md" },
				],
			}),
		)
		assert.equal(m.size, 2)
		assert.equal(m.get("adsum/x"), "a/x.md")
		assert.equal(m.get("adsum/y"), "b/y.md")
	})
	test("handles a manifest with no bits array", () => {
		assert.equal(indexManifest("{}").size, 0)
	})
})

describe("stripFrontmatter", () => {
	test("removes a leading block + the blank line after it", () => {
		assert.equal(stripFrontmatter("---\nid: x\n---\n\n# H\nbody"), "# H\nbody")
	})
	test("leaves text unchanged when there is no leading frontmatter", () => {
		assert.equal(stripFrontmatter("# H\n---\ndivider"), "# H\n---\ndivider")
	})
	test("leaves text unchanged when frontmatter is unclosed", () => {
		assert.equal(stripFrontmatter("---\nno close"), "---\nno close")
	})
})

describe("deriveId", () => {
	test("maps paths to canonical ids (platforms/ dropped, lowercased)", () => {
		assert.equal(deriveId("platforms/nrf/workflows/add-feature.md"), "adsum/nrf/workflows/add-feature")
		assert.equal(deriveId("AGENT.md"), "adsum/agent")
		assert.equal(deriveId("rules/core.md"), "adsum/rules/core")
		assert.equal(deriveId("platforms/nrf/PLATFORM.md"), "adsum/nrf/platform")
		assert.equal(deriveId("platforms/nrf/sdks/ncs/protocols/BLE.md"), "adsum/nrf/sdks/ncs/protocols/ble")
	})
})

describe("detectSafety", () => {
	test("detects flash / erase / process-kill commands", () => {
		assert.equal(detectSafety("run `west flash` now").has("flash"), true)
		assert.equal(detectSafety("west flash --erase").has("erase"), true)
		assert.equal(detectSafety("pkill -9 JLink").has("process-kill"), true)
		assert.equal(detectSafety("taskkill /F /IM JLink.exe").has("process-kill"), true)
	})
	test("does not false-positive on prose 'flash'", () => {
		assert.equal(detectSafety("I'll build and flash it for you").size, 0)
	})
})

// ---------------------------------------------------------------- lintBitContent

const md = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}`
const WF_FM = `id: adsum/nrf/workflows/add-feature
title: Add Feature
type: workflow
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
triggers: ["add a feature"]
requires: [adsum/nrf/actions/find-sample]`
const WF_PATH = "platforms/nrf/workflows/add-feature.md"
const WF_BODY = "# Add Feature Workflow (workflows/add-feature.md)\n\nStep 1: do the thing."
const KNOWN = new Set(["adsum/nrf/workflows/add-feature", "adsum/nrf/actions/find-sample"])

const errs = (issues: Issue[]) => issues.filter((i) => i.level === "error")

describe("lintBitContent", () => {
	test("a valid migrated bit produces no issues", () => {
		assert.deepEqual(lintBitContent(WF_PATH, md(WF_FM, WF_BODY), KNOWN), [])
	})

	test("unmigrated (no frontmatter) → one warning, no error", () => {
		const issues = lintBitContent(WF_PATH, WF_BODY, KNOWN)
		assert.equal(errs(issues).length, 0)
		assert.equal(issues.length, 1)
		assert.match(issues[0].msg, /no frontmatter/)
	})

	test("id mismatch with path → error", () => {
		const issues = lintBitContent("platforms/nrf/workflows/other.md", md(WF_FM, WF_BODY), KNOWN)
		assert.ok(errs(issues).some((i) => /does not match path-derived/.test(i.msg)))
	})

	test("dangling requires → error", () => {
		const fm = WF_FM.replace("adsum/nrf/actions/find-sample", "adsum/nrf/actions/ghost")
		const issues = lintBitContent(WF_PATH, md(fm, WF_BODY), new Set(["adsum/nrf/workflows/add-feature"]))
		assert.ok(errs(issues).some((i) => /unresolved bit reference/.test(i.msg)))
	})

	test("undeclared dangerous op → error; declaring it clears the error", () => {
		const body = `${WF_BODY}\n\nRun \`west flash\` to deploy.`
		const undeclared = lintBitContent(WF_PATH, md(WF_FM, body), KNOWN)
		assert.ok(errs(undeclared).some((i) => /safety.*does not declare/.test(i.msg)))

		const declared = lintBitContent(WF_PATH, md(`${WF_FM}\nsafety: [flash]`, body), KNOWN)
		assert.equal(errs(declared).length, 0)
	})

	test("unclosed frontmatter → error", () => {
		const issues = lintBitContent(WF_PATH, "---\nid: adsum/nrf/workflows/add-feature\nno close", KNOWN)
		assert.ok(errs(issues).some((i) => /never closed/.test(i.msg)))
	})

	test("invalid YAML → error", () => {
		const issues = lintBitContent(WF_PATH, "---\nid: [unterminated\n---\n# x", KNOWN)
		assert.ok(errs(issues).some((i) => /invalid YAML/.test(i.msg)))
	})

	test("schema error surfaces with field path", () => {
		const issues = lintBitContent(WF_PATH, md(WF_FM.replace("1.0.0", "BAD"), WF_BODY), KNOWN)
		assert.ok(errs(issues).some((i) => /schema: version/.test(i.msg)))
	})

	test("missing H1 path → warning (not error)", () => {
		const issues = lintBitContent(WF_PATH, md(WF_FM, "# Add Feature\n\nno path in title"), KNOWN)
		assert.equal(errs(issues).length, 0)
		assert.ok(issues.some((i) => i.level === "warn" && /H1 should name/.test(i.msg)))
	})
})

// ---------------------------------------------------------------- regression (real corpus)

describe("regression: live corpus", () => {
	// 17 bits: the post-un-bundle core/demo bits (delivery: bundled, open). The 10 CRA "SBOM & Fix" bits
	// (delivery: downloaded, LicenseRef-Adsum-Proprietary) were migrated OUT of this repo to
	// `Adsum-Backend/kbits/` (their single home, per Omar's K-bit dev workflow — "where the file lives = its
	// delivery"). They are no longer bundled in the VSIX: served from the registry in prod, and from the
	// `ADSUM_KBIT_LOCAL` dev override in F5. So the open corpus here holds only bundled bits.
	test("corpus is fully migrated and lint-clean: 17 bits, 0 errors, 0 unmigrated", () => {
		const { issues, files, migrated } = lintCorpus(KNOWLEDGE_ROOT)
		assert.equal(files.length, 17)
		assert.equal(migrated, 17)
		assert.equal(issues.filter((i) => i.level === "error").length, 0)
		const unmigrated = issues.filter((i) => i.msg.startsWith("no frontmatter"))
		assert.equal(unmigrated.length, 0)
	})

	test("migration only added frontmatter — device-identity body unchanged since v0.1.5 (fb3a178f)", () => {
		// Compare to the pre-K-bit 0.1.5 release (fb3a178f), NOT `main` — main now includes the migration.
		const original = execSync("git show fb3a178f:iot-knowledge/platforms/nrf/rules/device-identity.md", {
			cwd: REPO_ROOT,
			encoding: "utf8",
		})
		const current = readFileSync(join(KNOWLEDGE_ROOT, "platforms/nrf/rules/device-identity.md"), "utf8")
		const body = extractFrontmatter(current).body
		assert.equal(body.trim(), original.trim())
	})

	test("manifest.json is in sync with the corpus (run `npm run gen:kbit-manifest` if this fails)", () => {
		const manifest = JSON.parse(readFileSync(join(KNOWLEDGE_ROOT, "manifest.json"), "utf8"))
		const { migrated } = lintCorpus(KNOWLEDGE_ROOT)
		assert.equal(manifest.count, manifest.bits.length)
		assert.equal(manifest.count, migrated)
	})

	// Step guard: ALL downloaded bits — the general nRF/ESP corpus AND the 10 CRA "SBOM & Fix" bits — are
	// un-bundled (delivery: downloaded, served by the registry / the ADSUM_KBIT_LOCAL dev override). The
	// bundled manifest must now hold ONLY delivery: bundled bits — no exceptions. The CRA bits were migrated
	// to `Adsum-Backend/kbits/` (Phase-D + the single-home placement fix), so their ids must be absent from
	// the manifest AND their files gone from this tree. The nRF demo-forced bits MUST stay bundled
	// (DemoManager sync-loads them); un-bundled bits must not return.
	const CRA_MIGRATED = new Set([
		"adsum/cra/workflows/cra-readiness",
		"adsum/cra/workflows/cve-scan",
		"adsum/rules/next-step",
		"adsum/nrf/actions/cra-generate-sbom",
		"adsum/nrf/actions/cra-generate-sbom-fallbacks",
		"adsum/esp/actions/cra-generate-sbom",
		"adsum/nrf/rules/cra-posture",
		"adsum/esp/rules/cra-posture",
		"adsum/nrf/sdks/ncs/cra-advisories",
		"adsum/esp/sdks/esp-idf/cra-advisories",
	])
	test("bundled manifest holds ONLY bundled bits; CRA bits migrated out (absent from manifest + tree); demo bits stay; un-bundled bits absent", () => {
		const bits = JSON.parse(readFileSync(join(KNOWLEDGE_ROOT, "manifest.json"), "utf8")).bits as Array<{
			id: string
			delivery: string
		}>
		const ids = new Set(bits.map((b) => b.id))
		for (const b of bits) {
			assert.equal(
				CRA_MIGRATED.has(b.id),
				false,
				`${b.id} is a migrated CRA bit and must NOT be in the bundled manifest (now in Adsum-Backend/kbits/)`,
			)
			assert.equal(
				b.delivery,
				"bundled",
				`${b.id} is in the bundled manifest but delivery="${b.delivery}" (unexpected downloaded bit)`,
			)
		}
		// the migrated CRA bits must be gone from the bundled tree (no proprietary content in the VSIX)
		for (const p of [
			"cra/workflows/cra-readiness.md",
			"cra/workflows/cve-scan.md",
			"rules/next-step.md",
			"platforms/nrf/actions/cra-generate-sbom.md",
			"platforms/esp/rules/cra-posture.md",
			"platforms/nrf/sdks/ncs/cra-advisories.md",
		]) {
			assert.equal(existsSync(join(KNOWLEDGE_ROOT, p)), false, `${p} must be removed from the bundled tree (migrated)`)
		}
		// demo-forced bits MUST remain bundled (DemoManager resolveBitPathSync needs them)
		for (const id of [
			"adsum/nrf/workflows/demo-debug",
			"adsum/nrf/actions/flash",
			"adsum/nrf/actions/capture-logs",
			"adsum/nrf/sdks/ncs/protocols/ble",
		]) {
			assert.equal(ids.has(id), true, `${id} must stay bundled (DemoManager dependency)`)
		}
		// a sample of un-bundled bits must be absent (now downloaded-only, served by the registry)
		for (const id of [
			"adsum/esp/actions/build",
			"adsum/esp/workflows/prototype",
			"adsum/nrf/workflows/add-feature",
			"adsum/nrf/boards/nrf52840",
			"adsum/nrf/actions/run-twister",
		]) {
			assert.equal(ids.has(id), false, `${id} must NOT be in the bundled manifest (downloaded-only)`)
		}
		for (const p of ["platforms/esp/actions/build.md", "platforms/nrf/workflows/add-feature.md"]) {
			assert.equal(existsSync(join(KNOWLEDGE_ROOT, p)), false, `${p} must be removed from the bundled tree`)
		}
	})
})

// ---------------------------------------------------------------- P1: credibility roles (schema v2)

describe("kbit schema — roles & lifecycle (P1)", () => {
	test("accepts co_authors / endorsers / supporters / status / created / updated", () => {
		assert.equal(
			ok({
				...validAction,
				co_authors: [{ handle: "omar", name: "Omar" }],
				endorsers: [{ handle: "drx", name: "Dr X", affiliation: "Nordic", version: "1.0.0", date: "2026-06-14" }],
				supporters: [{ handle: "acme", kind: "backer" }],
				status: "published",
				created: "2026-01-01",
				updated: "2026-06-14",
			}),
			true,
		)
	})

	test("endorser.verified defaults to false; supporter.kind defaults to sponsor", () => {
		const parsed = kbitMetaSchema.parse({
			...validAction,
			endorsers: [{ handle: "drx", version: "1.0.0", date: "2026-06-14" }],
			supporters: [{ handle: "acme" }],
		})
		assert.equal(parsed.endorsers?.[0].verified, false)
		assert.equal(parsed.supporters?.[0].kind, "sponsor")
	})

	test("rejects self-endorsement (endorser is the author or a co-author)", () => {
		assert.equal(ok({ ...validAction, endorsers: [{ handle: "adsum", version: "1.0.0", date: "2026-06-14" }] }), false)
		assert.equal(
			ok({
				...validAction,
				co_authors: [{ handle: "omar" }],
				endorsers: [{ handle: "omar", version: "1.0.0", date: "2026-06-14" }],
			}),
			false,
		)
	})

	test("status enum is enforced", () => {
		assert.equal(ok({ ...validAction, status: "live" }), false)
		assert.equal(ok({ ...validAction, status: "deprecated" }), true)
	})
})

// ---------------------------------------------------------------- P1: lint v2 warnings

describe("lintBitContent — P1 warnings", () => {
	test("endorsement version drift → warning (not error)", () => {
		const fm = `${WF_FM}\nendorsers: [{handle: drx, version: "0.9.0", date: "2026-01-01"}]`
		const issues = lintBitContent(WF_PATH, md(fm, WF_BODY), KNOWN)
		assert.equal(errs(issues).length, 0)
		assert.ok(issues.some((i) => i.level === "warn" && /bump or re-endorse/.test(i.msg)))
	})

	test("deprecated/revoked status on a bundled bit → warning", () => {
		const issues = lintBitContent(WF_PATH, md(`${WF_FM}\nstatus: revoked`, WF_BODY), KNOWN)
		assert.equal(errs(issues).length, 0)
		assert.ok(issues.some((i) => i.level === "warn" && /can't be enforced independently/.test(i.msg)))
	})
})

// ---------------------------------------------------------------- P1: authoring core

describe("authoring", () => {
	test("generateFrontmatter emits a validated, fenced block", () => {
		const block = generateFrontmatter(validAction)
		assert.ok(block.startsWith("---\n") && block.trimEnd().endsWith("---"))
		assert.match(block, /id: adsum\/nrf\/actions\/flash/)
		assert.match(block, /author: adsum/)
	})

	test("generateFrontmatter throws on an invalid meta", () => {
		assert.throws(() => generateFrontmatter({ ...validAction, version: "BAD" }))
	})

	test("generateBody emits house-style markers per type", () => {
		const wf = generateBody({ type: "workflow", title: "Add Feature" }, "add-feature.md")
		assert.match(wf, /# Add Feature \(add-feature\.md\)/)
		assert.match(wf, /## Steps/)
		assert.match(wf, /MANDATORY SKILL LOAD/)
	})

	test("composeBit produces a lint-clean bit", () => {
		const meta = kbitMetaSchema.parse(validAction)
		const content = composeBit(meta, "flash.md")
		const issues = lintBitContent("platforms/nrf/actions/flash.md", content, new Set(["adsum/nrf/actions/flash"]))
		assert.equal(errs(issues).length, 0)
	})
})

// ---------------------------------------------------------------- P1: inspect core

const entry = (over: Partial<ManifestEntry>): ManifestEntry =>
	({
		id: "adsum/nrf/actions/build",
		title: "Build",
		type: "action",
		version: "1.0.0",
		owner: "adsum-core",
		author: "adsum",
		license: "CC-BY-SA-4.0",
		tier: "certified",
		delivery: "bundled",
		domain: "embedded-iot",
		platform: "nrf",
		path: "platforms/nrf/actions/build.md",
		content_hash: "deadbeefdeadbeef",
		...over,
	}) as ManifestEntry

describe("inspect", () => {
	const fixture: ManifestEntry[] = [
		entry({ id: "adsum/nrf/actions/build", type: "action", path: "platforms/nrf/actions/build.md" }),
		entry({ id: "adsum/nrf/workflows/add-feature", type: "workflow", path: "platforms/nrf/workflows/add-feature.md" }),
		entry({ id: "adsum/agent", type: "knowledge", platform: "universal", path: "AGENT.md" }),
	]

	test("buildTree groups by platform → type", () => {
		const tree = buildTree(fixture)
		assert.deepEqual(Object.keys(tree).sort(), ["nrf", "universal"])
		assert.deepEqual(Object.keys(tree.nrf).sort(), ["action", "workflow"])
		assert.equal(tree.universal.knowledge.length, 1)
	})

	test("filterEntries filters by type", () => {
		assert.equal(filterEntries(fixture, { type: "workflow" }).length, 1)
		assert.equal(filterEntries(fixture, { platform: "nrf" }).length, 2)
	})

	test("formatCatalog lists ids with the count", () => {
		const out = formatCatalog(fixture)
		assert.match(out, /3 bits/)
		assert.match(out, /adsum\/agent/)
	})

	test("formatBitDetail marks an unverified endorser as such", () => {
		const e = entry({
			endorsers: [
				{ handle: "drx", name: "Dr X", affiliation: "Nordic", version: "1.0.0", date: "2026-06-14", verified: false },
			],
		})
		const out = formatBitDetail(e)
		assert.match(out, /Dr X \(Nordic\).*\[unverified\]/)
	})

	test("formatBitDetail falls back to git dates when frontmatter has none", () => {
		const out = formatBitDetail(entry({}), { created: "2026-01-01", updated: "2026-06-14" })
		assert.match(out, /created:\s+2026-01-01/)
		assert.match(out, /updated:\s+2026-06-14/)
	})
})

// ---------------------------------------------------------------- dev-workflow guards (Part B)

const FM = (over: Partial<Record<string, string>> = {}) =>
	[
		"---",
		`id: ${over.id ?? "adsum/nrf/workflows/x"}`,
		'title: "X"',
		"type: workflow",
		`version: ${over.version ?? "1.0.0"}`,
		"owner: adsum-core",
		"author: adsum",
		"license: CC-BY-SA-4.0",
		"tier: certified",
		"delivery: bundled",
		"domain: embedded-iot",
		"platform: nrf",
		"---",
	].join("\n")
const bit = (body: string, over?: Partial<Record<string, string>>) => `${FM(over)}\n\n${body}\n`

describe("parseManifestEntries", () => {
	test("parses the bits array", () => {
		const json = JSON.stringify({ bits: [{ id: "a", version: "1.0.0", path: "p.md", content_hash: "h" }] })
		assert.deepEqual(parseManifestEntries(json), [{ id: "a", version: "1.0.0", path: "p.md", content_hash: "h" }])
	})
	test("returns [] on junk", () => {
		assert.deepEqual(parseManifestEntries("not json"), [])
		assert.deepEqual(parseManifestEntries("{}"), [])
	})
})

describe("lintVersionBump", () => {
	test("flags a body change with no version bump", () => {
		const issues = lintVersionBump("w.md", bit("NEW body"), bit("OLD body"))
		assert.equal(issues.length, 1)
		assert.match(issues[0].msg, /bump `version`/)
	})
	test("passes when the version was bumped", () => {
		const issues = lintVersionBump("w.md", bit("NEW body", { version: "1.1.0" }), bit("OLD body"))
		assert.deepEqual(issues, [])
	})
	test("passes when the body is unchanged", () => {
		assert.deepEqual(lintVersionBump("w.md", bit("same"), bit("same")), [])
	})
	test("ignores a brand-new bit (no HEAD)", () => {
		assert.deepEqual(lintVersionBump("w.md", bit("body"), null), [])
	})
})

describe("manifest freshness + mapping on the real corpus", () => {
	test("committed manifest.json matches the bits on disk (no stale drift)", () => {
		const files = listBitFiles(KNOWLEDGE_ROOT)
		const manifestJson = readFileSync(join(KNOWLEDGE_ROOT, "manifest.json"), "utf8")
		const errors = lintManifestFresh(KNOWLEDGE_ROOT, files, manifestJson).filter((i) => i.level === "error")
		assert.deepEqual(
			errors.map((e) => `${e.file}: ${e.msg}`),
			[],
		)
	})
})

// C2 — R4.3: license follows delivery (bundled ⇒ open / downloaded ⇒ proprietary).
describe("lint R4.3 — license follows delivery", () => {
	const r43bit = (delivery: string, license: string) =>
		[
			"---",
			"id: adsum/test/r43-fixture",
			"title: R4.3 fixture",
			"type: knowledge",
			"version: 0.1.0",
			"owner: adsum-core",
			"author: adsum",
			`license: ${license}`,
			"tier: certified",
			`delivery: ${delivery}`,
			"domain: cra",
			"---",
			"# R4.3 fixture (test/r43-fixture.md)",
			"body",
		].join("\n")
	const lint = (delivery: string, license: string) =>
		lintBitContent("test/r43-fixture.md", r43bit(delivery, license), new Set(["adsum/test/r43-fixture"]))

	test("bundled + proprietary → ERROR (the violation we hit)", () => {
		const issues = lint("bundled", "LicenseRef-Adsum-Proprietary")
		assert.ok(
			issues.some((i) => i.level === "error" && /bundled bit must be open/i.test(i.msg)),
			JSON.stringify(issues),
		)
	})
	test("downloaded + open → WARN", () => {
		const issues = lint("downloaded", "CC-BY-SA-4.0")
		assert.ok(
			issues.some((i) => i.level === "warn" && /downloaded bit is open/i.test(i.msg)),
			JSON.stringify(issues),
		)
	})
	test("bundled + open → no R4.3 issue", () => {
		const issues = lint("bundled", "CC-BY-SA-4.0")
		assert.ok(!issues.some((i) => /bundled bit must be open|downloaded bit is open/i.test(i.msg)), JSON.stringify(issues))
	})
	test("downloaded + proprietary (the CRA bits) → no R4.3 issue", () => {
		const issues = lint("downloaded", "LicenseRef-Adsum-Proprietary")
		assert.ok(!issues.some((i) => /bundled bit must be open|downloaded bit is open/i.test(i.msg)), JSON.stringify(issues))
	})
})
