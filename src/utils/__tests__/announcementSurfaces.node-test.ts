import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * "What's new" surfaces must reach a user, and must be talking about THIS release.
 *
 * 0.2.1 shipped with two announcement components in the source and only one alive. `WhatsNewModal` was
 * rendered solely by `WelcomeSection`, which nothing renders — so both were eliminated from the production
 * bundle, and a modal carrying free-tier-era copy read as current in the source for two releases. Meanwhile
 * the card that DOES reach users, `UpgradeCard`, still described the previous release. Nothing failed: the
 * copy was wrong in a live surface and stale in a dead one, and every test passed.
 *
 * Reachability is checked over the JSX render graph from `App.tsx`, not over imports. An import proves
 * nothing here — a barrel that re-exports a dead component is still an import, which is exactly how the
 * first version of this guard missed `WelcomeSection`.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/utils/__tests__/announcementSurfaces.node-test.ts
 */

// process.cwd(), not __dirname: mocha loads this file as an ES module, where __dirname does not exist.
// Referencing it throws at load time and takes down the WHOLE suite, not just this file — the run reports
// "Exception during run" and zero tests, which reads like a broken toolchain rather than one bad import.
// (Same trap hit on 2026-08-13 in a different test; both entry points run from the repo root.)
const REPO_ROOT = process.cwd()
const WEBVIEW_SRC = path.join(REPO_ROOT, "webview-ui", "src")
const APP_ROOT = path.join(WEBVIEW_SRC, "App.tsx")

/** Production .tsx components — stories and tests render dead code perfectly well, so they are excluded. */
function componentFiles(): string[] {
	const out: string[] = []
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (entry.name !== "node_modules" && entry.name !== "__tests__") {
					walk(p)
				}
			} else if (entry.name.endsWith(".tsx") && !/\.(test|spec|stories)\.tsx$/.test(entry.name)) {
				out.push(p)
			}
		}
	}
	walk(WEBVIEW_SRC)
	return out
}

/**
 * Components reachable from App.tsx by following JSX usage. Keyed by component name, since a name is what a
 * JSX tag gives us and every component here lives in a file of the same name.
 *
 * A name can map to SEVERAL files — this tree has two `WelcomeView.tsx` — so every candidate contributes its
 * children. Without that, picking one arbitrarily reports live components as dead: the first version of this
 * guard kept whichever duplicate came last and declared the shipping UpgradeCard unreachable.
 */
function reachableFromApp(files: string[]): Set<string> {
	const bodies = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]))
	const byName = new Map<string, string[]>()
	for (const f of files) {
		const name = path.basename(f).replace(/\.tsx$/, "")
		byName.set(name, [...(byName.get(name) ?? []), f])
	}
	const renderedIn = (file: string) => {
		const names = new Set<string>()
		for (const m of (bodies.get(file) ?? "").matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) {
			names.add(m[1])
		}
		return names
	}

	const seen = new Set<string>()
	const queue = ["App"]
	while (queue.length) {
		const name = queue.shift() as string
		if (seen.has(name)) {
			continue
		}
		seen.add(name)
		// No candidate file means a library component (Dialog, VSCodeButton, …) — nothing of ours below it.
		for (const file of byName.get(name) ?? []) {
			for (const child of renderedIn(file)) {
				if (!seen.has(child)) {
					queue.push(child)
				}
			}
		}
	}
	return seen
}

describe("announcement surfaces reach a user", () => {
	const files = componentFiles()

	test("App.tsx is the root and resolves", () => {
		assert.ok(fs.existsSync(APP_ROOT), `expected the webview app root at ${APP_ROOT}`)
	})

	// The failure this catches: an announcement component that renders perfectly in isolation, is imported
	// by a barrel, and is never mounted — so editing its copy changes nothing anyone sees.
	test('every component with a "What\'s new" headline is reachable from App.tsx', () => {
		const announcers = files.filter((f) => /What's new in v|cardTitle\(\)/.test(fs.readFileSync(f, "utf8")))
		assert.ok(announcers.length > 0, "no announcement surface found at all — this search is wrong")

		const live = reachableFromApp(files)
		const unreachable = announcers.map((f) => path.basename(f).replace(/\.tsx$/, "")).filter((name) => !live.has(name))
		assert.deepEqual(
			unreachable,
			[],
			`announcement surfaces not mounted anywhere below App.tsx — their copy can never be seen, so wire them up or delete them: ${unreachable.join(", ")}`,
		)
	})
})

describe("announcement copy names the shipping release", () => {
	const version: string = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version

	/**
	 * Every changelog entry an upgrading user has not seen yet: this version, plus any version above the
	 * newest one that actually reached people. A released version has a git tag; an entry with no tag was
	 * written up and never shipped.
	 *
	 * 0.3.0 is the case that made this necessary. It was dated and described as a release, never published,
	 * and its cellular work is new to everyone arriving from 0.2.1 — which is who the panel card speaks to.
	 * Comparing that card against this version's entry alone would have called correct copy stale.
	 */
	function unseenChangelog(): string {
		const changelog = fs.readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8")
		const start = changelog.indexOf(`## [${version}]`)
		assert.notEqual(start, -1, `CHANGELOG.md has no "## [${version}]" entry — add one before shipping`)

		let released = new Set<string>()
		try {
			released = new Set(
				execSync("git tag -l v*", { cwd: REPO_ROOT, encoding: "utf8" })
					.split("\n")
					.filter(Boolean)
					.map((t) => t.trim().replace(/^v/, "")),
			)
		} catch {
			// No git or no tags: fall back to this entry alone, which is the stricter reading.
		}

		const unseen: string[] = []
		for (const entry of changelog.slice(start).split(/\n(?=## \[)/)) {
			const seen = /^## \[([^\]]+)\]/.exec(entry)?.[1]
			if (seen && seen !== version && released.has(seen)) {
				break
			}
			unseen.push(entry)
		}
		return unseen.join("\n")
	}

	// The failure this catches: copy describing a PREVIOUS release under the CURRENT version number.
	// Rather than pin exact wording, which would fight every edit, require the live surfaces to share
	// vocabulary with everything the upgrading user has not been told about yet.
	test("the live surfaces share vocabulary with what an upgrading user has not seen", () => {
		const entry = unseenChangelog().toLowerCase()
		// Since 0.4.0 both live surfaces (the panel card and the update toast) read RELEASE_NOTES, so that
		// file is the surface. The reachability test above still proves the card is mounted.
		const surfaces: Array<[string, string]> = [
			["RELEASE_NOTES", fs.readFileSync(path.join(REPO_ROOT, "src", "shared", "releaseNotes.ts"), "utf8")],
		]
		// Distinctive nouns from the release, not filler. Each must appear in the changelog (proving it is
		// really this release's story) and in at least one live surface (proving users are told).
		// 0.4.1: the BLG20x first run, the account in the header, the LEW840x cellular images (the patch note carries them).
		const themes = ["account", "cellular", "blg20x", "lew840x"]
		for (const theme of themes) {
			assert.ok(
				entry.includes(theme),
				`"${theme}" is in no changelog entry an upgrading user has yet to see — update the themes list`,
			)
		}
		// Name where each missing theme was looked for, so fixing it does not mean reading this test.
		const missing = themes.filter((t) => !surfaces.some(([, body]) => body.toLowerCase().includes(t)))
		assert.deepEqual(
			missing,
			[],
			`this release's themes appear in neither live announcement surface: ${missing.join(", ")} — refresh the panel card (UpgradeCard.tsx) or the update toast (announcements.ts), whichever is stale`,
		)
	})

	// The toast is also the recurring nudge's fallback, so a returning user can meet it long after upgrade.
	test("the returning-user toast is not the first-install welcome", () => {
		const body = fs.readFileSync(path.join(REPO_ROOT, "src", "utils", "announcements.ts"), "utf8")
		assert.match(body, /isNewInstall/, "the toast must still split by audience")
		const notes = fs.readFileSync(path.join(REPO_ROOT, "src", "shared", "releaseNotes.ts"), "utf8")
		const welcome = /welcome:\s*"([^"]+)"/.exec(notes)?.[1] ?? ""
		const update = /update: "([^"]+)"/.exec(notes)?.[1] ?? ""
		assert.ok(welcome.length > 0 && update.length > 0, "RELEASE_NOTES.toast must define welcome and update")
		assert.ok(!/what's new/i.test(welcome), "the first-install welcome must not say what's new; nothing is old for them")
		assert.ok(!/no key needed/i.test(update), "the returning-user line must not carry the first-install free-tier framing")
	})
})
