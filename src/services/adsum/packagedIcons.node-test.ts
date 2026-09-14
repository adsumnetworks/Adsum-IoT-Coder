/**
 * Every icon package.json points at must be inside the package.
 *
 * 14 Sep: the header's signed-in account icon rendered as an empty gap after sign-in. A contributed icon whose
 * file is missing, excluded by .vscodeignore, or misspelled fails silently in the editor — no error anywhere,
 * just no glyph. This lists the files `vsce` would package and checks each referenced icon against that list.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/services/adsum/packagedIcons.node-test.ts
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

const root = path.resolve(__dirname, "../../..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

/** Every file path an icon field in the manifest refers to (codicon references like `$(add)` are not files). */
export function referencedIconFiles(manifest: Record<string, any>): string[] {
	const out = new Set<string>()
	const add = (v: unknown) => {
		if (typeof v === "string" && !v.startsWith("$(")) {
			out.add(v.replace(/^\.\//, ""))
		} else if (v && typeof v === "object") {
			for (const k of ["light", "dark"]) {
				add((v as Record<string, unknown>)[k])
			}
		}
	}
	add(manifest.icon)
	const c = manifest.contributes ?? {}
	for (const cmd of c.commands ?? []) {
		add(cmd.icon)
	}
	for (const icon of Object.values(c.icons ?? {}) as { default?: { fontPath?: string } }[]) {
		add(icon.default?.fontPath)
	}
	for (const containers of Object.values(c.viewsContainers ?? {}) as { icon?: unknown }[][]) {
		for (const v of containers) {
			add(v.icon)
		}
	}
	for (const views of Object.values(c.views ?? {}) as { icon?: unknown }[][]) {
		for (const v of views) {
			add(v.icon)
		}
	}
	return [...out].sort()
}

describe("I — icons ship", () => {
	test("I-01 every icon file package.json references is in the packaged file list", async () => {
		const { listFiles } = require("@vscode/vsce/out/package") as {
			listFiles: (o: Record<string, unknown>) => Promise<string[]>
		}
		const packaged = new Set((await listFiles({ cwd: root, dependencies: false })).map((f) => f.replace(/\\/g, "/")))
		const refs = referencedIconFiles(pkg)
		assert.ok(refs.includes("assets/icons/adsum-account.woff"), "the signed-in account icon font is referenced")
		const missing = refs.filter((f) => !packaged.has(f))
		assert.deepEqual(missing, [], `referenced by package.json but not packaged: ${missing.join(", ")}`)
	})

	test("I-02 the account icon: the outline person signed out, the same with a dot signed in, both from the packaged font", () => {
		const cmd = (id: string) => pkg.contributes.commands.find((c: { command: string }) => c.command === id)
		assert.equal(cmd("adsum.account.signIn").icon, "$(adsum-account)")
		assert.equal(cmd("adsum.account.menu").icon, "$(adsum-account-signed-in)")
		assert.equal(pkg.contributes.icons["adsum-account-signed-in"].default.fontPath, "assets/icons/adsum-account.woff")
		assert.equal(pkg.contributes.icons["adsum-account"].default.fontPath, "assets/icons/adsum-account.woff")
	})
})
