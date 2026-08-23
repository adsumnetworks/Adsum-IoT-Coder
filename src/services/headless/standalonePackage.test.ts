import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { headlessEngineAt, headlessEngineRef } from "./HeadlessEngine"

/**
 * The engine now ships inside the VSIX, which puts two things at risk that nothing else would catch:
 * the package quietly growing by the 40 MB dev zip or a 25 MB source map, and the engine losing the one
 * file that lets a run be attributed to a build. Both are packaging facts, so they are tested against
 * the built artifacts rather than mocked.
 */

const REPO = path.resolve(__dirname, "..", "..", "..")
const DIST = path.join(REPO, "dist-standalone")

/** Files the VSIX must carry for the engine to boot; the rest of dist-standalone is excluded. */
const MUST_SHIP = ["cline-core.js", "build-info.json", "proto/descriptor_set.pb", "node_modules/vscode/package.json"]
/**
 * A guard against accidental bloat, not a product target. Measured at 0.3.2: 13.3 MB before the engine, 24.3 MB
 * after — the engine bundle 5.3, the four per-platform better-sqlite3 addons 3.8, its runtime modules 1.6, all
 * compressed. The headroom is deliberately small: shipping standalone.zip, the source map, or an unpruned
 * node_modules each blows straight through it.
 */
const VSIX_BUDGET_MB = 26

describe("headlessEngineAt", () => {
	test("an extension dir with no engine reports absent, never a guess", () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-engine-"))
		const i = headlessEngineAt(empty)
		assert.equal(i.corePath, null)
		assert.equal(i.version, null)
		assert.equal(headlessEngineRef(i), null)
	})

	test("an engine with no build stamp is runnable but unattributable", () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "unstamped-"))
		fs.mkdirSync(path.join(d, "dist-standalone"), { recursive: true })
		fs.writeFileSync(path.join(d, "dist-standalone", "cline-core.js"), "//")
		const i = headlessEngineAt(d)
		assert.ok(i.corePath)
		assert.equal(i.sha, null, "no stamp → no sha, rather than a fabricated one")
		assert.equal(headlessEngineRef(i), "shipped ? v?")
	})

	test("a minified (production) engine cannot serve folder Knowledge bits", () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "stamped-"))
		fs.mkdirSync(path.join(d, "dist-standalone"), { recursive: true })
		fs.writeFileSync(path.join(d, "dist-standalone", "cline-core.js"), "//")
		fs.writeFileSync(
			path.join(d, "dist-standalone", "build-info.json"),
			JSON.stringify({ version: "0.3.2", sha: "1aa09b4c3d92ff60", dirty: false, minified: true, builtAt: "x" }),
		)
		const i = headlessEngineAt(d)
		assert.equal(i.supportsFolderKbits, false, "IS_DEV is eliminated in production builds")
		assert.equal(headlessEngineRef(i), "shipped 1aa09b4c v0.3.2")
	})

	test("a dev build keeps the folder-bit seam", () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "devbuild-"))
		fs.mkdirSync(path.join(d, "dist-standalone"), { recursive: true })
		fs.writeFileSync(path.join(d, "dist-standalone", "cline-core.js"), "//")
		fs.writeFileSync(path.join(d, "dist-standalone", "build-info.json"), JSON.stringify({ minified: false }))
		assert.equal(headlessEngineAt(d).supportsFolderKbits, true)
	})
})

describe("what the VSIX ships", () => {
	test("the built engine carries every file the core needs at boot", () => {
		if (!fs.existsSync(path.join(DIST, "cline-core.js"))) {
			console.log("    SKIP — no standalone build here; run `npm run compile-standalone:prod`")
			return
		}
		for (const f of MUST_SHIP) {
			assert.ok(fs.existsSync(path.join(DIST, f)), `${f} is missing from dist-standalone`)
		}
		const key = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`
		const addon = path.join(
			DIST,
			"binaries",
			key,
			"node_modules",
			"better-sqlite3",
			"build",
			"Release",
			"better_sqlite3.node",
		)
		assert.ok(fs.existsSync(addon), `no better-sqlite3 addon for ${key} — the core opens a locks db at boot`)
	})

	test("the engine is stamped, and stamped as a production build", () => {
		if (!fs.existsSync(path.join(DIST, "build-info.json"))) {
			console.log("    SKIP — no standalone build here")
			return
		}
		const i = headlessEngineAt(REPO)
		assert.ok(i.version, "build-info.json must name the version the engine was built from")
		assert.ok(headlessEngineRef(i)?.startsWith("shipped "))
	})

	test("a packaged VSIX stays within the size budget and leaks nothing large", () => {
		const dist = path.join(REPO, "dist")
		const vsix = fs.existsSync(dist)
			? fs
					.readdirSync(dist)
					.filter((f) => f.endsWith(".vsix"))
					.map((f) => ({ f, m: fs.statSync(path.join(dist, f)).mtimeMs }))
					.sort((a, b) => b.m - a.m)[0]?.f
			: undefined
		if (!vsix) {
			console.log("    SKIP — no VSIX built; run `npm run vsix`")
			return
		}
		const p = path.join(dist, vsix)
		const mb = fs.statSync(p).size / 1048576
		assert.ok(mb < VSIX_BUDGET_MB, `${vsix} is ${mb.toFixed(1)} MB, over the ${VSIX_BUDGET_MB} MB budget`)

		const listing = execFileSync("unzip", ["-l", p], { encoding: "utf8", maxBuffer: 32e6 })
		assert.ok(listing.includes("dist-standalone/cline-core.js"), "the engine must ship")
		assert.ok(listing.includes("dist-standalone/build-info.json"), "the build stamp must ship")
		for (const leak of [
			"standalone.zip",
			"cline-core.js.map",
			"vsce-extension/",
			"better-sqlite3/deps/",
			"dist-standalone/tree-sitter-",
		]) {
			assert.ok(!listing.includes(leak), `${leak} leaked into the VSIX`)
		}
	})
})
