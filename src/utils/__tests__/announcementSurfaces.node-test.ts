import assert from "node:assert/strict"
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

const REPO_ROOT = path.join(__dirname, "..", "..", "..")
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
		const announcers = files.filter((f) => /What's new in v/.test(fs.readFileSync(f, "utf8")))
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

	/** The changelog entry for the current version — the release's own account of itself. */
	function currentChangelogEntry(): string {
		const changelog = fs.readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8")
		const start = changelog.indexOf(`## [${version}]`)
		assert.notEqual(start, -1, `CHANGELOG.md has no "## [${version}]" entry — add one before shipping`)
		const next = changelog.indexOf("\n## [", start + 1)
		return changelog.slice(start, next === -1 ? undefined : next)
	}

	// The failure this catches: copy describing the PREVIOUS release under the CURRENT version number.
	// Rather than pin exact wording, which would fight every edit, require the live surfaces to share
	// vocabulary with the changelog entry for the version actually being shipped.
	test("the live surfaces share vocabulary with this version's changelog entry", () => {
		const entry = currentChangelogEntry().toLowerCase()
		const surfaces: Array<[string, string]> = [
			["UpgradeCard", fs.readFileSync(path.join(WEBVIEW_SRC, "components", "chat", "UpgradeCard.tsx"), "utf8")],
			["update toast", fs.readFileSync(path.join(REPO_ROOT, "src", "utils", "announcements.ts"), "utf8")],
		]
		// Distinctive nouns from the release, not filler. Each must appear in the changelog (proving it is
		// really this release's story) and in at least one live surface (proving users are told).
		const themes = ["memory", "compaction", "log", "session"]
		for (const theme of themes) {
			assert.ok(entry.includes(theme), `"${theme}" is not in the ${version} changelog entry — update the themes list`)
		}
		const missing = themes.filter((t) => !surfaces.some(([, body]) => body.toLowerCase().includes(t)))
		assert.deepEqual(
			missing,
			[],
			`this release's themes appear in no live announcement surface: ${missing.join(", ")} — the panel card and the toast still describe an older release`,
		)
	})

	// The toast is also the recurring nudge's fallback, so a returning user can meet it long after upgrade.
	test("the returning-user toast is not the first-install welcome", () => {
		const body = fs.readFileSync(path.join(REPO_ROOT, "src", "utils", "announcements.ts"), "utf8")
		assert.match(body, /isNewInstall/, "the toast must still split by audience")
		assert.ok(
			!/What's new in Adsum IoT Coder v\$\{version\}[^`]*no key needed/.test(body),
			"the returning-user line must not carry the first-install free-tier framing",
		)
	})
})
