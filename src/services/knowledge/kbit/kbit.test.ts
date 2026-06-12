import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"
import { extractFrontmatter, stripFrontmatter } from "./frontmatter"
import { deriveId, detectSafety, type Issue, lintBitContent, lintCorpus } from "./lint"
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
	test("corpus is fully migrated and lint-clean: 26 bits, 0 errors, 0 unmigrated", () => {
		const { issues, files, migrated } = lintCorpus(KNOWLEDGE_ROOT)
		assert.equal(files.length, 26)
		assert.equal(migrated, 26)
		assert.equal(issues.filter((i) => i.level === "error").length, 0)
		const unmigrated = issues.filter((i) => i.msg.startsWith("no frontmatter"))
		assert.equal(unmigrated.length, 0)
	})

	test("add-feature migration preserved the body byte-for-byte (only frontmatter added)", () => {
		const original = execSync("git show main:iot-knowledge/platforms/nrf/workflows/add-feature.md", {
			cwd: REPO_ROOT,
			encoding: "utf8",
		})
		const current = readFileSync(join(KNOWLEDGE_ROOT, "platforms/nrf/workflows/add-feature.md"), "utf8")
		const body = extractFrontmatter(current).body
		assert.equal(body.trim(), original.trim())
	})

	test("manifest.json is in sync with the corpus (run `npm run gen:kbit-manifest` if this fails)", () => {
		const manifest = JSON.parse(readFileSync(join(KNOWLEDGE_ROOT, "manifest.json"), "utf8"))
		const { migrated } = lintCorpus(KNOWLEDGE_ROOT)
		assert.equal(manifest.count, manifest.bits.length)
		assert.equal(manifest.count, migrated)
	})
})
