#!/usr/bin/env node

import archiver from "archiver"
import { execSync } from "child_process"
import fs from "fs"
import { cp } from "fs/promises"
import { glob } from "glob"
import minimatch from "minimatch"
import os from "os"
import path from "path"
import { rmrf } from "./file-utils.mjs"

const BUILD_DIR = "dist-standalone"
const BINARIES_DIR = `${BUILD_DIR}/binaries`
const RUNTIME_DEPS_DIR = "standalone/runtime-files"
const IS_DEBUG_BUILD = process.env.IS_DEBUG_BUILD === "true"

// This should match the node version packaged with the JetBrains plugin.
const TARGET_NODE_VERSION = "22.15.0"
const TARGET_PLATFORMS = [
	{ platform: "win32", arch: "x64", targetDir: "win-x64" },
	{ platform: "darwin", arch: "x64", targetDir: "darwin-x64" },
	{ platform: "darwin", arch: "arm64", targetDir: "darwin-arm64" },
	{ platform: "linux", arch: "x64", targetDir: "linux-x64" },
]
const SUPPORTED_BINARY_MODULES = ["better-sqlite3"]

const UNIVERSAL_BUILD = !process.argv.includes("-s")
const IS_VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose")
// The VSIX ships the engine as loose files, not as standalone.zip — the zip is a dev convenience for
// `runclinecore.sh` and the Studio's tarball path. `--no-zip` prepares dist-standalone (vscode stub +
// per-platform binaries) and stops there, so the release build does not spend a minute writing 40 MB
// nobody installs.
const NO_ZIP = process.argv.includes("--no-zip")

async function main() {
	await installNodeDependencies()
	if (UNIVERSAL_BUILD) {
		console.log("Building universal package for all platforms...")
		await packageAllBinaryDeps()
	} else {
		console.log(`Building package for ${os.platform()}-${os.arch()}...`)
	}
	if (NO_ZIP) {
		await pruneToRuntimeClosure()
		console.log("Skipping standalone.zip (--no-zip): the VSIX ships dist-standalone as loose files.")
		return
	}
	await zipDistribution()
}

/**
 * Reduce dist-standalone/node_modules to what the engine actually requires at runtime.
 *
 * esbuild bundles everything except the modules listed as `external` for the standalone build; those few must be
 * resolvable on disk, along with their transitive dependencies. Everything else in here is build-time machinery
 * (prebuild-install and its tarball stack) that would otherwise ride into every user's VSIX. Computing the closure
 * instead of listing it means a new external is picked up by adding one name to RUNTIME_EXTERNALS, and `.vscodeignore`
 * can keep saying simply "ship node_modules".
 *
 * Only on the --no-zip (VSIX) path: standalone.zip is a developer artifact and keeps the full tree.
 */
async function pruneToRuntimeClosure() {
	// better-sqlite3 is external too, but it ships from binaries/<platform>/ — never from here. Its own runtime
	// dependency does live here though: `bindings` is what finds the .node addon, and better-sqlite3 resolves it
	// through NODE_PATH (see the resolution banner in esbuild.mjs). Its other dependency, prebuild-install, runs
	// at install time only and is deliberately left out.
	const RUNTIME_EXTERNALS = ["vscode", "@grpc/reflection", "grpc-health-check", "bindings"]
	// Declared as dependencies by packages that only consume their types. `require()` never asks for these.
	const TYPES_ONLY = (name) => name.startsWith("@types/") || name === "undici-types"

	const modulesDir = path.join(BUILD_DIR, "node_modules")
	const keep = new Set()
	const walk = (name) => {
		if (keep.has(name) || TYPES_ONLY(name)) {
			return
		}
		const pkgJson = path.join(modulesDir, name, "package.json")
		if (!fs.existsSync(pkgJson)) {
			throw new Error(`standalone runtime dependency '${name}' is missing from ${modulesDir} — the engine would not boot`)
		}
		keep.add(name)
		const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"))
		// Peers count. @grpc/reflection declares @grpc/grpc-js as a peer, requires it at load, and a closure
		// built from `dependencies` alone drops it — the engine then dies at boot on "Cannot find module".
		// Optional peers do not: they are absent by design and the package handles that itself.
		const optionalPeer = (n) => pkg.peerDependenciesMeta?.[n]?.optional === true
		const deps = [
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.peerDependencies ?? {}).filter((n) => !optionalPeer(n)),
		]
		for (const dep of deps) {
			walk(dep)
		}
	}
	RUNTIME_EXTERNALS.forEach(walk)

	// Scoped packages live one level deeper; compare on the full "@scope/name".
	const present = []
	for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
		if (entry.name.startsWith("@")) {
			for (const sub of fs.readdirSync(path.join(modulesDir, entry.name))) {
				present.push(`${entry.name}/${sub}`)
			}
		} else if (entry.name !== ".package-lock.json") {
			present.push(entry.name)
		}
	}
	let dropped = 0
	for (const name of present) {
		if (!keep.has(name)) {
			await rmrf(path.join(modulesDir, name))
			dropped++
		}
	}
	console.log(`Pruned node_modules to the runtime closure: kept ${keep.size}, dropped ${dropped}.`)
}

async function installNodeDependencies() {
	// Clean modules from any previous builds
	await rmrf(path.join(BUILD_DIR, "node_modules"))
	await rmrf(path.join(BINARIES_DIR))

	await cpr(RUNTIME_DEPS_DIR, BUILD_DIR)

	// --ignore-scripts: nothing here is ever run on the build host. better-sqlite3 is the one native dep and
	// packageAllBinaryDeps() downloads a PREBUILT binary for each of the four target platforms below; a host
	// compile would produce a fifth binary for this machine's Node ABI that is then deleted. Skipping it also
	// unties the release build from the host's Node version — node-gyp against Node 26 headers fails outright,
	// which used to break `npm run package` on a developer machine that had simply upgraded Node.
	console.log("Running npm install in distribution directory...")
	execSync("npm install --ignore-scripts --no-audit --no-fund", { stdio: "inherit", cwd: BUILD_DIR })

	// Move the vscode stub into node_modules (external:"vscode" in the bundle resolves it from there at
	// runtime). It can't be installed via npm because that creates a symlink which unzips incorrectly on
	// Windows. Made IDEMPOTENT + guarded: a re-run over an existing node_modules/vscode used to throw on
	// rename and leave the stub misplaced in dist-standalone/vscode → the standalone core then dies at
	// import with "Cannot find module 'vscode'". Ensure the parent exists, clear any prior copy, then move.
	const vscodeSrc = `${BUILD_DIR}/vscode`
	const vscodeDest = `${BUILD_DIR}/node_modules/vscode`
	fs.mkdirSync(`${BUILD_DIR}/node_modules`, { recursive: true })
	await rmrf(vscodeDest)
	if (fs.existsSync(vscodeSrc)) {
		fs.renameSync(vscodeSrc, vscodeDest)
	}
	// Hard verification: a standalone build that can't resolve its vscode stub is broken — fail the build
	// LOUDLY here rather than shipping an artifact that boots to "Cannot find module 'vscode'".
	if (!fs.existsSync(path.join(vscodeDest, "package.json"))) {
		throw new Error(
			`vscode stub not placed at ${vscodeDest} — the standalone core would fail to boot. ` +
				`Check that ${RUNTIME_DEPS_DIR}/vscode exists and the copy above succeeded.`,
		)
	}
}

/**
 * Downloads prebuilt binaries for each platform for the modules that include binaries. It uses `npx prebuild-install`
 * to download the binary.
 *
 * The modules are downloaded to dist-standalone/binaries/{os}-{platform}/.
 * When cline-core is installed, the installer should use the correct module for the current platform.
 */
async function packageAllBinaryDeps() {
	// Check for native modules. With --ignore-scripts nothing has been compiled yet, so look for the SOURCE of a
	// native module (binding.gyp / a prebuilt .node that came down in the tarball) rather than for build output —
	// otherwise this guard silently passes and a new native dependency reaches the distribution unpackaged.
	const nativeMarkers = await glob(["**/binding.gyp", "**/*.node"], { cwd: path.join(BUILD_DIR, "node_modules"), nodir: true })
	// Split on EITHER separator. glob hands back backslashes on Windows, so a forward-slash-only split
	// leaves the whole path as one segment ("better-sqlite3\binding.gyp"), the allow-list can never
	// match, and the guard rejects the very module it is meant to permit. Green on Linux and macOS,
	// fatal on Windows — where ~95% of users are (2026-08-23).
	const isAllowed = (p) => SUPPORTED_BINARY_MODULES.some((allowed) => p.split(/[\\/]/).includes(allowed))
	const blocked = nativeMarkers.filter((x) => !isAllowed(x))

	if (blocked.length > 0) {
		console.error(`Error: Native node modules cannot be included in the standalone distribution:\n\n${blocked.join("\n")}`)
		console.error(
			"\nThese modules must support prebuilt-install and be added to the supported list in scripts/package-standalone.mjs",
		)
		process.exit(1)
	}

	for (const module of SUPPORTED_BINARY_MODULES) {
		console.log(`Installing binaries for ${module}...`)
		const src = path.join(BUILD_DIR, "node_modules", module)
		if (!fs.existsSync(src)) {
			console.warn(`Warning: Trying to install binaries for the module '${module}', but it is not being used by cline.`)
			continue
		}

		for (const { platform, arch, targetDir } of TARGET_PLATFORMS) {
			const binaryDir = `${BINARIES_DIR}/${targetDir}/node_modules`
			fs.mkdirSync(binaryDir, { recursive: true })

			// Copy the module from the build dir
			const dest = path.join(binaryDir, module)
			await cpr(src, dest)

			// Download the binary libs
			const v = IS_VERBOSE ? "--verbose" : ""
			const cmd = `npx prebuild-install --platform=${platform} --arch=${arch} --target=${TARGET_NODE_VERSION} ${v}`
			log_verbose(`${module}: ${cmd}`)
			execSync(cmd, { cwd: dest, stdio: "inherit" })
			log_verbose("")
		}
		// Remove the original module with the host platform binaries installed directly into node_modules.
		log_verbose(`Cleaning up host version of ${module}`)
		await rmrf(src)
		log_verbose("")
	}
}

async function zipDistribution() {
	// Zip the build directory (excluding any pre-existing output zip).
	const zipPath = path.join(BUILD_DIR, "standalone.zip")
	const output = fs.createWriteStream(zipPath)
	const startTime = Date.now()
	const archive = archiver("zip", { zlib: { level: 6 } })

	output.on("close", () => {
		const endTime = Date.now()
		const duration = (endTime - startTime) / 1000
		console.log(`Created ${zipPath} (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB) in ${duration.toFixed(2)} seconds`)
	})
	archive.on("warning", (err) => {
		console.warn(`Warning: ${err}`)
	})
	archive.on("error", (err) => {
		throw err
	})

	archive.pipe(output)
	// Add all the files from the standalone build dir.
	archive.glob("**/*", {
		cwd: BUILD_DIR,
		ignore: ["standalone.zip"],
	})

	// Exclude the same files as the VCE vscode extension packager.
	// Also ignore the dist directory, the build directory for the extension.
	const isIgnored = createIsIgnored(["dist/**"])

	// Add the whole cline directory under "extension", except the for the ignored files.
	archive.directory(process.cwd(), "extension", (entry) => {
		if (isIgnored(entry.name)) {
			//log_verbose("Ignoring", entry.name)
			return false
		}
		return entry
	})

	console.log("Zipping package...")
	await archive.finalize()
}

/**
 * This is based on https://github.com/microsoft/vscode-vsce/blob/fafad8a63e9cf31179f918eb7a4eeb376834c904/src/package.ts#L1695
 * because the .vscodeignore format is not compatible with the `ignore` npm module.
 */
function createIsIgnored(standaloneIgnores) {
	const MinimatchOptions = { dot: true }
	const defaultIgnore = [
		".vscodeignore",
		"package-lock.json",
		"npm-debug.log",
		"yarn.lock",
		"yarn-error.log",
		"npm-shrinkwrap.json",
		".editorconfig",
		".npmrc",
		".yarnrc",
		".gitattributes",
		"*.todo",
		"tslint.yaml",
		".eslintrc*",
		".babelrc*",
		".prettierrc*",
		"biome.json*",
		".cz-config.js",
		".commitlintrc*",
		"webpack.config.js",
		"ISSUE_TEMPLATE.md",
		"CONTRIBUTING.md",
		"PULL_REQUEST_TEMPLATE.md",
		"CODE_OF_CONDUCT.md",
		".github",
		".travis.yml",
		"appveyor.yml",
		"**/.git",
		"**/.git/**",
		"**/*.vsix",
		"**/.DS_Store",
		"**/*.vsixmanifest",
		"**/.vscode-test/**",
		"**/.vscode-test-web/**",
	]

	const rawIgnore = fs.readFileSync(".vscodeignore", "utf8")

	// Parse raw ignore by splitting output into lines and filtering out empty lines and comments
	const parsedIgnore = rawIgnore
		.split(/[\n\r]/)
		.map((s) => s.trim())
		.filter((s) => !!s)
		.filter((i) => !/^\s*#/.test(i))

	// Add '/**' to possible folder names
	const expandedIgnore = [
		...parsedIgnore,
		...parsedIgnore.filter((i) => !/(^|\/)[^/]*\*[^/]*$/.test(i)).map((i) => (/\/$/.test(i) ? `${i}**` : `${i}/**`)),
	]

	// Combine with default ignore list
	// Also ignore the dist directory- the build directory for the extension.
	let allIgnore = [...defaultIgnore, ...expandedIgnore, ...standaloneIgnores]

	// Map files need to be included in the debug build. Remove .map ignores when IS_DEBUG_BUILD is set
	if (IS_DEBUG_BUILD) {
		allIgnore = allIgnore.filter((pattern) => !pattern.endsWith(".map"))
		console.log("Debug build: Including .map files in package")
	}

	// Split into ignore and negate list
	const [ignore, negate] = allIgnore.reduce(
		(r, e) => (!/^\s*!/.test(e) ? [[...r[0], e], r[1]] : [r[0], [...r[1], e]]),
		[[], []],
	)

	function isIgnored(f) {
		return (
			ignore.some((i) => minimatch(f, i, MinimatchOptions)) &&
			!negate.some((i) => minimatch(f, i.substr(1), MinimatchOptions))
		)
	}
	return isIgnored
}

/* cp -r */
async function cpr(source, dest) {
	log_verbose(`Copying ${source} -> ${dest}`)
	await cp(source, dest, {
		recursive: true,
		preserveTimestamps: true,
		dereference: false, // preserve symlinks instead of following them
	})
}

function log_verbose(...args) {
	if (IS_VERBOSE) {
		console.log(...args)
	}
}

await main()
