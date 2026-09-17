/**
 * Nothing of ours that is not the product rides into the package.
 *
 * `.vscodeignore` is a list, and a list only excludes what someone remembered to name: a new maintainer folder
 * is packaged until it is added. This lists the files `vsce` would actually package, the same list the icon test
 * reads, and fails on maintainer folders and on any packaged text that names a local machine or a private repo.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/services/adsum/packageShipsNothingPrivate.node-test.ts
 */
import { strict as assert } from "node:assert"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

const root = path.resolve(__dirname, "../../..")

/** Folders and files that are how WE work on the extension. None is read by the extension at runtime. */
const PRIVATE_PATHS = [
	/^\.adsum\//,
	/^\.dev-probes\//,
	/^\.claude\//,
	/^\.agents\//,
	/^CLAUDE(\.[a-z]+)?\.md$/,
	/^\.env$/,
	/^\.mcp\.json$/,
]

/** What a packaged file must never contain: this machine, the bench, the private repository's name. */
const PRIVATE_TEXT = [/\/Users\/ihamdad\b/, /\/home\/adsum-bench\b/, /Adsum-IoT-Coder-Review/]

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|wasm|node|pb|zip|gz|pdf|mp4|vsix)$/i

async function packaged(): Promise<string[]> {
	const { listFiles } = require("@vscode/vsce/out/package") as {
		listFiles: (o: Record<string, unknown>) => Promise<string[]>
	}
	return (await listFiles({ cwd: root, dependencies: false })).map((f) => f.replace(/\\/g, "/"))
}

describe("P — the package ships nothing private", () => {
	test("P-01 no maintainer memory or local configuration is in the packaged file list", async () => {
		const leaked = (await packaged()).filter((f) => PRIVATE_PATHS.some((re) => re.test(f)))
		assert.deepEqual(leaked, [], `would be packaged: ${leaked.join(", ")}`)
	})

	test("P-02 no packaged text file names this machine, the bench or the private repository", async () => {
		const hits: string[] = []
		for (const f of await packaged()) {
			if (BINARY.test(f)) {
				continue
			}
			const abs = path.join(root, f)
			// A built bundle is large but still text, and it is exactly where a baked-in path would land.
			if (statSync(abs).size > 20_000_000) {
				continue
			}
			const text = readFileSync(abs, "utf8")
			for (const re of PRIVATE_TEXT) {
				if (re.test(text)) {
					hits.push(`${f} (${re.source})`)
				}
			}
		}
		assert.deepEqual(hits, [], `packaged files carrying private text: ${hits.join(", ")}`)
	})
})
