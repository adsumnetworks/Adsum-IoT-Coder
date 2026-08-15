import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { canHoldMemory, hasProjectMarker, isForbiddenMemoryRoot, memoryAnchors, resolveMemoryAnchor } from "./projectAnchor"
import { ensureAdsumScaffold } from "./store"

/**
 * THE FAILURE THIS PINS (2026-08-13): a prototype run started with no folder open, so cwd was the
 * developer's Desktop, and the agent created a full `.adsum/` there — PROJECT.md, status.json, and a
 * researched note on Minew tag payloads. Real knowledge, written where its project would never find it.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/memory/workspace/projectAnchor.test.ts
 */

function tmpProject(markers: string[] = ["prj.conf"]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-"))
	for (const m of markers) {
		fs.writeFileSync(path.join(root, m), "")
	}
	return root
}

describe("personal folders can never hold memory — the Desktop case", () => {
	const home = os.homedir()
	for (const dir of [
		home,
		path.join(home, "Desktop"),
		path.join(home, "Documents"),
		path.join(home, "Downloads"),
		path.join(home, "OneDrive"),
		path.parse(home).root,
		os.tmpdir(),
	]) {
		test(`refuses ${dir}`, () => {
			assert.equal(isForbiddenMemoryRoot(dir), true)
			assert.equal(canHoldMemory(dir), false, "must be refused even if a stray marker exists there")
		})
	}

	test("a trailing separator or different case does not sneak past", () => {
		assert.equal(isForbiddenMemoryRoot(`${path.join(home, "Desktop")}${path.sep}`), true)
		assert.equal(isForbiddenMemoryRoot(path.join(home, "Desktop").toUpperCase()), true)
	})

	test("undefined is refused rather than defaulted", () => {
		assert.equal(canHoldMemory(undefined), false)
	})

	test("ensureAdsumScaffold creates NOTHING in a forbidden folder", () => {
		// The actual regression: this is what wrote .adsum to the Desktop.
		const desktop = path.join(home, "Desktop")
		const before = fs.existsSync(path.join(desktop, ".adsum"))
		assert.equal(ensureAdsumScaffold(desktop), undefined, "must refuse")
		assert.equal(fs.existsSync(path.join(desktop, ".adsum")), before, "must not have created anything")
	})
})

describe("a real project can hold memory", () => {
	test("recognises the usual project markers", () => {
		for (const marker of ["prj.conf", "CMakeLists.txt", "sdkconfig", "west.yml", ".git", "package.json"]) {
			const root = tmpProject([marker])
			try {
				assert.equal(hasProjectMarker(root), true, `${marker} should mark a project`)
				assert.equal(canHoldMemory(root), true)
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		}
	})

	test("an empty directory is not a project", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"))
		try {
			assert.equal(canHoldMemory(root), false, "no marker means no memory")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("anchoring: memory follows the code", () => {
	test("a single app anchors on the app, not the folder above it", () => {
		const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"))
		const app = path.join(parent, "ble-scanner")
		fs.mkdirSync(app)
		fs.writeFileSync(path.join(app, "prj.conf"), "")
		try {
			assert.equal(resolveMemoryAnchor(parent, [app]), app)
		} finally {
			fs.rmSync(parent, { recursive: true, force: true })
		}
	})

	test("the gateway case: shared layer plus one per app", () => {
		// gw/ holds two apps -> gw/.adsum (goal, cross-chip contract) and one .adsum per app.
		const gw = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
		fs.writeFileSync(path.join(gw, "CMakeLists.txt"), "")
		const scanner = path.join(gw, "ble-scanner")
		const fwd = path.join(gw, "wifi-forwarder")
		for (const a of [scanner, fwd]) {
			fs.mkdirSync(a)
			fs.writeFileSync(path.join(a, "prj.conf"), "")
		}
		try {
			const anchors = memoryAnchors(gw, [scanner, fwd])
			assert.equal(anchors.length, 3, `expected shared + 2 apps, got ${JSON.stringify(anchors)}`)
			assert.equal(anchors[0], gw, "shared layer first")
			assert.ok(anchors.includes(scanner) && anchors.includes(fwd))
		} finally {
			fs.rmSync(gw, { recursive: true, force: true })
		}
	})

	test("one app does NOT also get a shared layer — that would duplicate it", () => {
		const parent = fs.mkdtempSync(path.join(os.tmpdir(), "single-"))
		fs.writeFileSync(path.join(parent, "CMakeLists.txt"), "")
		const app = path.join(parent, "only-app")
		fs.mkdirSync(app)
		fs.writeFileSync(path.join(app, "prj.conf"), "")
		try {
			assert.deepEqual(memoryAnchors(parent, [app]), [app])
		} finally {
			fs.rmSync(parent, { recursive: true, force: true })
		}
	})

	test("a container with 2 apps and NO marker of its own still gets the shared layer", () => {
		// The real shape that stranded a note on the Desktop: `asset_tag/` is just a folder holding
		// `tag/` and `locator/`. It has no prj.conf of its own, so a marker-only rule gave cross-app
		// knowledge nowhere to live. Grouping two real apps is itself the evidence.
		const parent = fs.mkdtempSync(path.join(os.tmpdir(), "container-"))
		const a = path.join(parent, "tag")
		const b = path.join(parent, "locator")
		for (const d of [a, b]) {
			fs.mkdirSync(d)
			fs.writeFileSync(path.join(d, "prj.conf"), "")
		}
		try {
			assert.equal(fs.existsSync(path.join(parent, "prj.conf")), false, "precondition: parent has no marker")
			const anchors = memoryAnchors(parent, [a, b])
			assert.equal(anchors[0], parent, "the shared layer is the apps' common parent")
			assert.equal(anchors.length, 3)
		} finally {
			fs.rmSync(parent, { recursive: true, force: true })
		}
	})

	test("apps in unrelated trees get NO shared layer — their common parent is a personal folder", () => {
		const home = os.homedir()
		const anchors = memoryAnchors(home, [path.join(home, "Desktop", "p1"), path.join(home, "Desktop", "p2")])
		assert.ok(!anchors.includes(path.join(home, "Desktop")), "the Desktop must never become a shared anchor")
	})

	test("no project anywhere: no anchors, nothing written", () => {
		const desktop = path.join(os.homedir(), "Desktop")
		assert.deepEqual(memoryAnchors(desktop, []), [])
		assert.equal(resolveMemoryAnchor(desktop, []), undefined)
	})

	test("apps under a forbidden root still work — the app itself is a project", () => {
		// Real shape: C:\Users\me\Desktop\gw_minew\ble-scanner. The Desktop is forbidden; the app is not.
		const parent = fs.mkdtempSync(path.join(os.tmpdir(), "under-"))
		const app = path.join(parent, "ble-scanner")
		fs.mkdirSync(app)
		fs.writeFileSync(path.join(app, "prj.conf"), "")
		try {
			assert.equal(resolveMemoryAnchor(os.homedir(), [app]), app, "the app is a valid anchor on its own")
		} finally {
			fs.rmSync(parent, { recursive: true, force: true })
		}
	})
})
