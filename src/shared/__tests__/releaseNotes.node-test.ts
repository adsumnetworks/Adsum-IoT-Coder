import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"
import { AGENT_HANDOVER_ENABLED } from "../handover"
import { acknowledgesVersion, RELEASE_NOTES, toastText } from "../releaseNotes"

/**
 * The release-copy guard. RELEASE_NOTES is the one place release messages live; this is what makes a
 * release REVIEW it rather than remember to.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/shared/__tests__/releaseNotes.node-test.ts
 */

// process.cwd(), not __dirname: mocha loads this as an ES module where __dirname does not exist.
const REPO_ROOT = process.cwd()
const read = (...p: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...p), "utf8")

/** Every string in the object, with the path that led to it, so a failure names the field. */
function strings(value: unknown, at = "RELEASE_NOTES"): Array<[string, string]> {
	if (typeof value === "string") {
		return [[at, value]]
	}
	if (Array.isArray(value)) {
		return value.flatMap((v, i) => strings(v, `${at}[${i}]`))
	}
	if (value && typeof value === "object") {
		return Object.entries(value).flatMap(([k, v]) => strings(v, `${at}.${k}`))
	}
	return []
}

describe("RELEASE_NOTES is reviewed for the version being shipped", () => {
	const packageVersion: string = JSON.parse(read("package.json")).version

	// The failure this catches: a version bump with last release's messages still in the product.
	test("package.json version is the announced release or an acknowledged patch", () => {
		assert.ok(
			acknowledgesVersion(packageVersion),
			`package.json is ${packageVersion} but RELEASE_NOTES announces ${RELEASE_NOTES.version} and acknowledges no such patch. ` +
				`Either rewrite RELEASE_NOTES for ${packageVersion}, or add patches["${packageVersion}"] = { silent: true } if there is nothing to announce.`,
		)
	})

	test("the changelog has an entry for the announced release", () => {
		assert.ok(
			read("CHANGELOG.md").includes(`## [${RELEASE_NOTES.version}]`),
			`CHANGELOG.md has no "## [${RELEASE_NOTES.version}]" entry`,
		)
	})

	test("the README's What's New names the release being shipped", () => {
		// A patch with a note is something users hear about, so the README leads with it; a silent patch
		// changes nothing a reader should notice, and the heading stays on the release it patches.
		const patch = RELEASE_NOTES.patches[packageVersion]
		const shown = patch && "note" in patch ? packageVersion : RELEASE_NOTES.version
		assert.ok(
			read("README.md").includes(`What's New <sup>\`v${shown}\`</sup>`),
			`README.md's What's New heading is not on v${shown}`,
		)
	})

	test("the surfaces that show the version take it from one field", () => {
		const typed = strings(RELEASE_NOTES).filter(
			([at, s]) => at !== "RELEASE_NOTES.version" && !at.startsWith("RELEASE_NOTES.patches") && /\b0\.\d+\.\d+\b/.test(s),
		)
		assert.deepEqual(
			typed.map(([at]) => at),
			[],
			"a version number is typed into copy; use {version} or cardTitle() instead",
		)
	})
})

describe("RELEASE_NOTES copy obeys the house rules", () => {
	test("no em dashes anywhere", () => {
		const offenders = strings(RELEASE_NOTES).filter(([, s]) => s.includes("—"))
		assert.deepEqual(
			offenders.map(([at]) => at),
			[],
			"em dash in release copy",
		)
	})

	test("toasts stay under 200 characters once filled in", () => {
		for (const kind of ["update", "cra", "welcome"] as const) {
			const text = toastText(kind)
			assert.ok(text.length < 200, `toast.${kind} is ${text.length} characters: "${text}"`)
			assert.ok(!text.includes("{"), `toast.${kind} has an unfilled placeholder: "${text}"`)
		}
	})

	test("the card has three lines, each with a head and a body", () => {
		assert.equal(RELEASE_NOTES.card.lines.length, 3)
		for (const line of RELEASE_NOTES.card.lines) {
			assert.ok(line.head.length > 0 && line.body.length > 0)
			assert.ok(line.head.length <= 12, `card head "${line.head}" is too long for the label column`)
		}
	})
})

describe("RELEASE_NOTES agrees with the code it describes", () => {
	// The failure this catches: a badge on a sample that was renamed or removed, so it shows on nothing
	// or on the wrong row.
	test("every newSamples id is a registered sample", () => {
		const registry = read("webview-ui", "src", "components", "chat", "demoScenarios.ts")
		const missing = RELEASE_NOTES.newSamples.filter((id) => !registry.includes(`"${id}": {`))
		assert.deepEqual(missing, [], `newSamples names samples that do not exist in demoScenarios.ts: ${missing.join(", ")}`)
	})

	// The failure this catches: the switch flips and the "Coming soon" label stays, or the other way round.
	test("what is named as not offered matches the handover switch", () => {
		const listed = RELEASE_NOTES.claims.notOffered.includes("Bring your own coding agent")
		assert.equal(
			listed,
			!AGENT_HANDOVER_ENABLED,
			AGENT_HANDOVER_ENABLED
				? "handover is enabled but RELEASE_NOTES still names it as not offered"
				: "handover is off but RELEASE_NOTES no longer names it as not offered",
		)
	})

	test("the About page reads its table from here, not from a copy of its own", () => {
		const about = read("webview-ui", "src", "components", "settings", "sections", "AboutSection.tsx")
		assert.ok(about.includes("RELEASE_NOTES.claims.runsOn"), "AboutSection.tsx no longer reads RELEASE_NOTES.claims.runsOn")
		assert.ok(!/const PLATFORMS\s*[:=]/.test(about), "AboutSection.tsx has grown its own platform table again")
	})
})
