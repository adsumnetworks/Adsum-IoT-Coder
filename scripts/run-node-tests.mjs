#!/usr/bin/env node
/**
 * Run every test written for node's own runner, and fail if any of them fails.
 *
 * WHY THIS EXISTS. The unit runner is mocha, and its glob (`src/**\/__tests__/*.ts`) also loaded the test
 * files written with `node:test`. Their assertions ran inside mocha's process under node's runner, printed
 * ✖ lines, and never failed the mocha run — so "1413 passing" could sit on top of a red file, and on
 * 13 September kbitVisibility.node-test.ts was red on main and nobody could see it. Most node:test files
 * were not under any glob at all and ran only if someone remembered their one-off script.
 *
 * WHAT COUNTS as a node-runner test: any `src/**\/*.node-test.ts`, and any `src/**\/*.test.ts` that imports
 * `node:test`. Found by content as well as by name, because a file's runner is what it imports, not what
 * it is called. Mocha excludes the same set (.mocharc.cjs `ignore`, from the same shared definition), so no file is run by both or by neither.
 *
 * HOW EACH RUNS: in its own process — one file's crash or hang cannot take another's result with it — with
 * the flags its own `test:*` script in package.json uses when it has one (some need the editor stub, some
 * need path aliases), and otherwise with both. A file that exits non-zero, or that has not finished within
 * the time limit, is red. The summary names every red file; the exit code is 1 if there is any.
 *
 *   node scripts/run-node-tests.mjs               # all of them
 *   node scripts/run-node-tests.mjs --list        # what would run, and with which flags
 *   node scripts/run-node-tests.mjs <file> [...]  # just these
 *   node scripts/run-node-tests.mjs --with-live   # also the tests that need a live service running
 *
 * LIVE-SERVICE TESTS (`*E2e.node-test.ts`, `*.e2e.node-test.ts`) need something this command does not start —
 * hostE2e needs the end-to-end backend on :7788 and its database. Run blind they fail for the wrong reason,
 * and they write to that database. So they are SKIPPED by default and the summary names each one and why;
 * a skip is never counted as a pass.
 *
 * Exit: 0 every file green · 1 at least one red file · 2 no test files found (a runner that finds nothing
 * is broken, not passing).
 */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const LIST = argv.includes("--list")
const WITH_LIVE = argv.includes("--with-live")
const isLive = (rel) => /(E2e|\.e2e)\.node-test\.ts$/.test(rel)
const only = argv.filter((a) => !a.startsWith("--"))
const TIMEOUT_MS = Number(process.env.NODE_TESTS_TIMEOUT_MS || 240_000)
const JOBS = Math.max(1, Number(process.env.NODE_TESTS_JOBS || Math.min(6, os.cpus().length)))
const DEFAULT_FLAGS = [
	"--transpile-only",
	"-P",
	"tsconfig.unit-test.json",
	"-r",
	"tsconfig-paths/register",
	"-r",
	"./src/test/requires.ts",
]

const { findNodeRunnerTests } = createRequire(import.meta.url)("./node-runner-tests.cjs")

/**
 * The ts-node flags — and any environment assignments written in front of ts-node — that a file's own
 * package.json script uses, or null if it has none.
 */
function scriptFor(rel) {
	const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {}
	for (const cmd of Object.values(scripts)) {
		const m = String(cmd).match(/^((?:[A-Z_][A-Z0-9_]*=\S*\s+)*)ts-node\s+(.*?)\s+(\S+\.ts)\s*$/)
		if (m && m[3] === rel) {
			const env = Object.fromEntries(
				m[1]
					.trim()
					.split(/\s+/)
					.filter(Boolean)
					.map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]),
			)
			return { flags: m[2].split(/\s+/).filter(Boolean), env }
		}
	}
	return null
}
const flagsFromScripts = (rel) => scriptFor(rel)?.flags ?? null

function runOne(rel) {
	const own = scriptFor(rel)
	const flags = own?.flags ?? DEFAULT_FLAGS
	return new Promise((resolve) => {
		const started = Date.now()
		const child = spawn(path.join(ROOT, "node_modules", ".bin", "ts-node"), [...flags, rel], {
			cwd: ROOT,
			env: { ...process.env, ...(own?.env ?? {}), FORCE_COLOR: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		})
		let output = ""
		child.stdout.on("data", (d) => (output += d))
		child.stderr.on("data", (d) => (output += d))
		let timedOut = false
		const timer = setTimeout(() => {
			timedOut = true
			child.kill("SIGKILL")
		}, TIMEOUT_MS)
		child.on("close", (code) => {
			clearTimeout(timer)
			const pass = /^ℹ pass (\d+)/m.exec(output)?.[1]
			const fail = /^ℹ fail (\d+)/m.exec(output)?.[1]
			const failing = [...output.matchAll(/^\s*✖ (.+?)(?: \([\d.]+ms\))?$/gm)].map((m) => m[1])
			resolve({
				rel,
				ok: !timedOut && code === 0,
				code,
				timedOut,
				pass: pass === undefined ? null : Number(pass),
				fail: fail === undefined ? null : Number(fail),
				failing: [...new Set(failing)].filter((t) => t !== "failing tests:"),
				ms: Date.now() - started,
				tail: output.split("\n").slice(-25).join("\n"),
			})
		})
	})
}

const found = only.length ? only : findNodeRunnerTests()
const skipped = only.length || WITH_LIVE ? [] : found.filter(isLive)
const files = found.filter((f) => !skipped.includes(f))
if (files.length === 0) {
	console.error("run-node-tests: no node-runner test files found — the runner is broken, not passing.")
	process.exit(2)
}
if (LIST) {
	for (const f of files) console.log(`${f}   ${flagsFromScripts(f) ? "(its own script's flags)" : "(default flags)"}`)
	console.log(`\n${files.length} file(s)`)
	process.exit(0)
}

console.log(`run-node-tests: ${files.length} file(s), ${JOBS} at a time, ${TIMEOUT_MS / 1000}s limit each`)
const results = []
let next = 0
await Promise.all(
	Array.from({ length: JOBS }, async () => {
		while (next < files.length) {
			const rel = files[next++]
			const r = await runOne(rel)
			results.push(r)
			const counts = r.pass === null ? "" : ` ${r.pass} pass · ${r.fail} fail`
			console.log(
				`${r.ok ? "  ok  " : "  RED "} ${rel}${counts}${r.timedOut ? " · TIMED OUT" : ""}${!r.ok && !r.timedOut && r.fail === 0 ? ` · exit ${r.code}` : ""}`,
			)
		}
	}),
)

for (const s of skipped) {
	console.log(`  SKIP  ${s} · needs a live service (see its header); run with --with-live`)
}
const red = results.filter((r) => !r.ok).sort((a, b) => a.rel.localeCompare(b.rel))
const tests = results.reduce((n, r) => n + (r.pass ?? 0) + (r.fail ?? 0), 0)
if (red.length) {
	console.error(`\n${red.length} red file(s) of ${results.length}:`)
	for (const r of red) {
		console.error(`\n✖ ${r.rel}${r.timedOut ? " — timed out" : ` — exit ${r.code}`}`)
		if (r.failing.length) for (const t of r.failing) console.error(`    ✖ ${t}`)
		else console.error(r.tail.replace(/^/gm, "    "))
	}
	process.exit(1)
}
console.log(
	`\nrun-node-tests: all ${results.length} file(s) green · ${tests} test(s)${skipped.length ? ` · ${skipped.length} live-service file(s) skipped, not passed` : ""}`,
)
