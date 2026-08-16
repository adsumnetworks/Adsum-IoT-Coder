#!/usr/bin/env node
/**
 * Copy the newest built VSIX to a STABLE filename: `adsum-LATEST.vsix`.
 *
 * Why this exists: every dev build bumps the version, so the artifact is called
 * nrf-ai-debugger-0.2.1-dev.9.vsix, then …dev.10, then …dev.11. The folder never changes, but the file
 * to install is named something different every time and the previous one is deleted — which reads as
 * the build "moving". Asked directly on 2026-08-16: "where is the vsix?? why you keep changing its place".
 *
 * So: install `adsum-LATEST.vsix` from the repo root, always. It is a copy, not a rename — the
 * versioned file stays put, because the version is what tells you which build you are running when
 * something is wrong.
 *
 * Gitignored: a 13 MB binary that changes on every build has no business in git history.
 */
import { copyFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const STABLE = "adsum-LATEST.vsix"

const builds = readdirSync(ROOT)
	.filter((f) => f.endsWith(".vsix") && f !== STABLE && /\d+\.\d+\.\d+/.test(f))
	.map((f) => ({ f, mtime: statSync(path.join(ROOT, f)).mtimeMs }))
	.sort((a, b) => b.mtime - a.mtime)

if (builds.length === 0) {
	console.error("No .vsix found — run `npx vsce package` first.")
	process.exit(1)
}

const newest = builds[0].f
copyFileSync(path.join(ROOT, newest), path.join(ROOT, STABLE))
console.log(`\n  Install this:  ${path.join(ROOT, STABLE)}`)
console.log(`  (copy of ${newest})\n`)
