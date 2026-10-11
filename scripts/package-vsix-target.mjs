#!/usr/bin/env node
/**
 * Package a platform-specific VSIX that carries the extension's own Python for that platform
 * (scripts/build-python-runtime.mjs), so the service tool runs over Bluetooth with nothing installed.
 *
 *   npm run vsix:target -- darwin-arm64        # or darwin-x64, linux-x64, linux-arm64, win32-x64
 *
 * The universal `npm run vsix` stays as it was and carries no runtime (.vscodeignore excludes runtimes/**): its
 * Python tools use the developer's Python, as before. A platform VSIX re-includes only its own runtime through a
 * generated ignore file, so each download carries one platform's runtime (18 to 30 MB compressed). The Marketplace
 * serves the platform build where one is published and the universal one elsewhere.
 * Run `npm run package` first (as `npm run vsix` does), or pass --build to do it here.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"]
const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith("--"))
if (!target || !TARGETS.includes(target)) {
	console.error(`usage: npm run vsix:target -- <${TARGETS.join("|")}> [--build]`)
	process.exit(2)
}
const sh = (cmd, a) => execFileSync(cmd, a, { cwd: ROOT, stdio: "inherit" })
if (!existsSync(path.join(ROOT, "runtimes", "python", target, "ADSUM-RUNTIME.json"))) {
	sh(process.execPath, [path.join(ROOT, "scripts", "build-python-runtime.mjs"), target])
}
if (args.includes("--build")) {
	sh("npm", ["run", "package"])
}
const ignore = path.join(ROOT, ".cache", `vscodeignore-${target}`)
// .cache is not in a fresh clone (11 Oct 2026: the release dry run failed here after a clean checkout).
mkdirSync(path.dirname(ignore), { recursive: true })
const base = readFileSync(path.join(ROOT, ".vscodeignore"), "utf8")
writeFileSync(
	ignore,
	`${base}\n# ${target}: this platform's Python, and nothing else of runtimes/ (scripts/package-vsix-target.mjs)\n!runtimes/python/${target}/**\n`,
)
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
const out = path.join("dist", `${pkg.name}-${pkg.version}-${target}.vsix`)
sh(process.execPath, [
	path.join(ROOT, "node_modules", "@vscode", "vsce", "vsce"),
	"package",
	"--no-dependencies",
	"--allow-star-activation",
	// The standalone engine's minified code reads as a SendGrid key to vsce's scanner (`SG.prototype._destroy`); the
	// repo's publish scripts allow that one false positive the same way.
	"--allow-package-secrets",
	"sendgrid",
	"--target",
	target,
	"--ignoreFile",
	ignore,
	"--out",
	out,
])
console.log(`packaged ${out}`)
