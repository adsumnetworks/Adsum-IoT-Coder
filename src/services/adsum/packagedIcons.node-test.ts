/**
 * Every icon package.json points at must be inside the package, be contributed, and hold the glyph it names.
 *
 * 14 Sep: the header's signed-in account icon rendered as an empty gap after sign-in. A contributed icon whose
 * file is missing, excluded by .vscodeignore, or misspelled fails silently in the editor — no error anywhere,
 * just no glyph. This lists the files `vsce` would package and checks each referenced icon against that list.
 *
 * Later the same day the signed-OUT icon rendered as a missing-glyph box instead. The manifest was right and the
 * font was right; what was wrong was that the font had been REPLACED IN PLACE at `assets/icons/adsum-account.woff`.
 * The first version of that file held only `\e901`, and the icon added afterwards asks for `\e900`. A contributed
 * icon font is registered under the extension id joined to its path, so the path is the font's identity: a window
 * that had already loaded the old bytes from that path kept them, and the character the header asked for was not
 * in the font it got — which is a box, not a gap. So the font moved to a path of its own, and two checks below
 * make the class of failure loud instead of silent: I-03 says a header icon id must actually be contributed, and
 * I-04 reads each font's own cmap and says the character the manifest names must be in it. I-04 is the one that
 * fails against the old file; I-01's packaging check and I-02's spelling check both passed while the box showed.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/services/adsum/packagedIcons.node-test.ts
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { inflateSync } from "node:zlib"

const root = path.resolve(__dirname, "../../..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

/**
 * The icon ids the panel header asks for: every `$(id)` on a command that sits in the view/title menu.
 *
 * A header button's icon is named twice in the manifest — once on the command, once by putting that command in
 * `view/title` — and the id it names has to exist in `contributes.icons` or the editor renders nothing at all.
 */
export function headerIconIds(manifest: Record<string, any>): string[] {
	const c = manifest.contributes ?? {}
	const inHeader = new Set(
		((c.menus?.["view/title"] ?? []) as { command?: string }[]).map((row) => row.command).filter(Boolean) as string[],
	)
	const out = new Set<string>()
	for (const cmd of (c.commands ?? []) as { command?: string; icon?: unknown }[]) {
		if (!cmd.command || !inHeader.has(cmd.command)) {
			continue
		}
		const m = typeof cmd.icon === "string" ? /^\$\(([^)]+)\)$/.exec(cmd.icon) : null
		if (m) {
			// `$(icon~spin)` is the same icon with a modifier; the id is the part before the tilde.
			out.add(m[1].split("~")[0])
		}
	}
	return [...out].sort()
}

/** The tables of a WOFF, TrueType or OpenType font, by tag, decompressed. */
function fontTables(buf: Buffer): Map<string, Buffer> {
	const out = new Map<string, Buffer>()
	const woff = buf.subarray(0, 4).toString("latin1") === "wOFF"
	const numTables = buf.readUInt16BE(woff ? 12 : 4)
	const entry = woff ? 20 : 16
	let at = woff ? 44 : 12
	for (let i = 0; i < numTables; i++) {
		const tag = buf.subarray(at, at + 4).toString("latin1")
		const offset = buf.readUInt32BE(at + 4 + (woff ? 0 : 4))
		const compLength = buf.readUInt32BE(at + 8 + (woff ? 0 : 4))
		const origLength = woff ? buf.readUInt32BE(at + 12) : compLength
		const raw = buf.subarray(offset, offset + compLength)
		out.set(tag, compLength !== origLength ? inflateSync(raw) : raw)
		at += entry
	}
	return out
}

/** Every character code a font's `cmap` maps, from its format 4 and format 12 subtables. */
export function fontCharacters(file: string): Set<number> {
	const cmap = fontTables(readFileSync(file)).get("cmap")
	assert.ok(cmap, `${file}: the font has no cmap table, so it maps no characters at all`)
	const out = new Set<number>()
	const subtables = cmap.readUInt16BE(2)
	for (let i = 0; i < subtables; i++) {
		const at = cmap.readUInt32BE(8 + i * 8)
		const format = cmap.readUInt16BE(at)
		if (format === 4) {
			const segments = cmap.readUInt16BE(at + 6) / 2
			for (let s = 0; s < segments; s++) {
				const end = cmap.readUInt16BE(at + 14 + s * 2)
				const start = cmap.readUInt16BE(at + 16 + segments * 2 + s * 2)
				if (start === 0xffff) {
					continue // the required terminating segment, not a real range
				}
				for (let ch = start; ch <= end; ch++) {
					out.add(ch)
				}
			}
		} else if (format === 12) {
			const groups = cmap.readUInt32BE(at + 12)
			for (let g = 0; g < groups; g++) {
				const start = cmap.readUInt32BE(at + 16 + g * 12)
				const end = cmap.readUInt32BE(at + 20 + g * 12)
				for (let ch = start; ch <= end; ch++) {
					out.add(ch)
				}
			}
		}
	}
	return out
}

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
		const missing = refs.filter((f) => !packaged.has(f))
		assert.deepEqual(missing, [], `referenced by package.json but not packaged: ${missing.join(", ")}`)
	})

	test("I-02 the account icon is the editor's own codicon: sign-in signed out, account signed in, no contributed font", () => {
		// Round 22 (B26): in a Remote SSH window no extension-contributed icon font loaded — ours or a vendor's — while
		// the editor's own codicons rendered. The header must not depend on a contributed font.
		const cmd = (id: string) => pkg.contributes.commands.find((c: { command: string }) => c.command === id)
		assert.equal(cmd("adsum.account.signIn").icon, "$(sign-in)")
		assert.equal(cmd("adsum.account.menu").icon, "$(account)")
		const icons = Object.keys(pkg.contributes.icons ?? {})
		assert.ok(!icons.some((id) => id.startsWith("adsum-account")), `still contributed: ${icons.join(", ")}`)
	})

	test("I-03 every icon id the header asks for is a codicon or contributed", () => {
		const contributed = new Set(Object.keys(pkg.contributes.icons ?? {}))
		const header = headerIconIds(pkg)
		// The header has buttons; a run that found none is a broken reader, not a clean result.
		assert.ok(header.length >= 3, `expected the header to name icons, found ${header.length}`)
		assert.ok(header.includes("sign-in"), "the signed-out account item is a header icon")
		assert.ok(header.includes("account"), "the signed-in account item is a header icon")
		// A codicon (`$(history)`, `$(gear)`) is the editor's own and needs no contribution; anything named with our
		// own prefix must be contributed, or the editor draws nothing where the button should be.
		const ours = header.filter((id) => id.startsWith("adsum") || id.startsWith("cline"))
		const uncontributed = ours.filter((id) => !contributed.has(id))
		assert.deepEqual(
			uncontributed,
			[],
			`used by a header button but absent from contributes.icons: ${uncontributed.join(", ")}`,
		)
	})

	test("I-04 every contributed icon's font really holds the character the manifest names", () => {
		const icons = Object.entries(pkg.contributes.icons ?? {}) as [
			string,
			{ default: { fontPath: string; fontCharacter: string } },
		][]
		assert.ok(icons.length > 0, "no contributed icons found — a reader that finds nothing is broken, not passing")
		const broken: string[] = []
		for (const [id, icon] of icons) {
			const { fontPath, fontCharacter } = icon.default ?? {}
			assert.ok(fontPath, `${id}: no fontPath`)
			assert.ok(fontCharacter, `${id}: no fontCharacter, so the editor has no glyph to draw`)
			const code = parseInt(fontCharacter.replace(/\\/g, ""), 16)
			assert.ok(Number.isFinite(code), `${id}: fontCharacter ${fontCharacter} is not a hex character code`)
			if (!fontCharacters(path.join(root, fontPath)).has(code)) {
				broken.push(`${id} wants \\${code.toString(16)} but ${fontPath} does not map it`)
			}
		}
		assert.deepEqual(broken, [], broken.join("; "))
	})
})
