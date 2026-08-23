#!/usr/bin/env node
/**
 * Build the Tool bits whose source is TypeScript that already lives in the extension.
 *
 * Two decoders — the btmon HCI decoder and the Nordic BLE sniffer decoder — are pure functions with
 * no host imports, so they can run as Tool bits and be improved from the registry without a release.
 * Rewriting ~1,300 lines of fixture-tested parser by hand to get there would be regression risk for
 * nothing, so instead: the TypeScript stays put and keeps its existing tests, and esbuild emits one
 * single `.mjs` per tool — dependency-free where it can be, and with a NOTICE where it cannot. ONE source, two consumers — the tests exercise exactly the code
 * that ships.
 *
 * Not minified, deliberately. The artifact is meant to be readable: the protection lever for a Tool
 * bit is the registry's fetch gate, not obfuscation (see tool-bits/02 §5). Minifying would also strip
 * the MIT attribution the HCI decoder must carry, which is why that notice is a `/*! @license` block
 * rather than a plain comment.
 *
 *   node scripts/build-tool-bundles.mjs [--check]
 *
 * `--check` rebuilds into a temp dir and fails if the committed bundle differs — the CI guard against
 * a source edit that never made it into the artifact, which is the drift this whole arrangement
 * exists to prevent.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const check = process.argv.includes("--check")

/** Every tool built from in-repo TypeScript. `notice` travels as its own declared artifact. */
const TOOLS = [
	{
		id: "adsum/nrf/tools/hci-decode",
		entry: "src/services/nrf/hci/cli.ts",
		out: "iot-knowledge/platforms/nrf/tools/hci-decode/hci_decode.mjs",
	},
	{
		id: "adsum/nrf/tools/sniffer-decode",
		entry: "src/services/nrf/sniffer/cli.ts",
		out: "iot-knowledge/platforms/nrf/tools/sniffer-decode/sniffer_decode.mjs",
	},
	{
		// The one PROPRIETARY tool built from this repo's TypeScript, so its bundle lands in the backend's
		// kbits tree rather than iot-knowledge: a proprietary tool must never ship inside the VSIX, and the
		// bundled tree is what the VSIX carries. Publishing it therefore needs both checkouts — the same
		// coupling `--root` publishing already has, and the reason the path is configurable.
		id: "adsum/cra/tools/cve-scan",
		entry: "src/services/cra/cli.ts",
		out: process.env.ADSUM_KBITS_ROOT
			? `${process.env.ADSUM_KBITS_ROOT}/cra/tools/cve-scan/cve_scan.mjs`
			: "../Adsum-Backend-tbit/kbits/cra/tools/cve-scan/cve_scan.mjs",
	},
]

async function bundle(tool, outFile) {
	const result = await esbuild.build({
		entryPoints: [path.join(ROOT, tool.entry)],
		outfile: outFile,
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node18",
		minify: false,
		legalComments: "inline",
		// Nothing outside node: may end up in a Tool bit. A bundle that needs an npm package could not
		// run from the tool cache, where there is no node_modules and never will be.
		external: [],
		logLevel: "warning",
		metafile: true,
	})
	const externalImports = new Set()
	for (const input of Object.keys(result.metafile.inputs)) {
		for (const imp of result.metafile.inputs[input].imports ?? []) {
			if (imp.external && !imp.path.startsWith("node:")) {
				externalImports.add(imp.path)
			}
		}
	}
	if (externalImports.size) {
		throw new Error(`${tool.id}: bundle imports non-builtins: ${[...externalImports].join(", ")}`)
	}

	// The externals check above only catches what is left OUT of the bundle. A dependency that gets
	// bundled IN passes it silently — which is how cve-scan shipped ~85 KB of js-yaml, 60% of its own
	// size, with the MIT notice that library's licence requires nowhere in sight. So: any third-party
	// code inside the artifact must be declared, and the tool must carry a NOTICE naming it.
	const vendored = [...new Set([...readFileSync(outFile, "utf8").matchAll(/node_modules\/((?:@[^/\s]+\/)?[^/\s]+)/g)].map((m) => m[1]))]
	if (vendored.length) {
		const noticePath = path.join(path.dirname(outFile), "NOTICE")
		const notice = existsSync(noticePath) ? readFileSync(noticePath, "utf8") : ""
		const unnamed = vendored.filter((dep) => !notice.includes(dep))
		if (unnamed.length) {
			throw new Error(
				`${tool.id}: bundles ${unnamed.join(", ")} but NOTICE does not name ${unnamed.length === 1 ? "it" : "them"}. ` +
					`Third-party code carries licence obligations that travel with the bytes — add a NOTICE beside the ` +
					`bundle, declare it in artifacts[], or remove the dependency.`,
			)
		}
		console.log(`  ${tool.id}: bundles ${vendored.join(", ")} — named in NOTICE ✓`)
	}
	return readFileSync(outFile, "utf8")
}

let failed = 0
for (const tool of TOOLS) {
	const committed = path.resolve(ROOT, tool.out)
	if (check) {
		const tmp = mkdtempSync(path.join(tmpdir(), "adsum-tbit-"))
		try {
			const fresh = await bundle(tool, path.join(tmp, path.basename(tool.out)))
			let current = ""
			try {
				current = readFileSync(committed, "utf8")
			} catch {
				// absent — reported as drift below
			}
			if (fresh !== current) {
				console.error(`❌ ${tool.id}: the committed bundle does not match its source.`)
				console.error("   Run `npm run build:tool-bundles`, refresh artifacts[].sha256 and bump the version.")
				failed++
			} else {
				console.log(`✔ ${tool.id}  bundle matches source`)
			}
		} finally {
			rmSync(tmp, { recursive: true, force: true })
		}
		continue
	}

	const text = await bundle(tool, committed)
	// A Tool bit's descriptor declares the sha256 of every member, and a stale hash makes the client
	// refuse the tool. Refresh it here so building and declaring can never fall out of step.
	const descriptor = path.join(path.dirname(committed), "TOOL.md")
	try {
		const sha = execFileSync("shasum", ["-a", "256", committed], { encoding: "utf8" }).split(" ")[0]
		const md = readFileSync(descriptor, "utf8")
		const member = path.basename(committed)
		const re = new RegExp(`(- path: ${member.replace(/\./g, "\\.")}\\n\\s+sha256: )[0-9a-f]{64}`)
		if (re.test(md)) {
			writeFileSync(descriptor, md.replace(re, `$1${sha}`))
			console.log(`✔ ${tool.id}  ${(text.length / 1024).toFixed(1)} KB  · descriptor hash refreshed`)
		} else {
			console.log(`✔ ${tool.id}  ${(text.length / 1024).toFixed(1)} KB  · (no TOOL.md member row yet)`)
		}
	} catch {
		console.log(`✔ ${tool.id}  ${(text.length / 1024).toFixed(1)} KB`)
	}
}

if (failed) {
	process.exit(1)
}
