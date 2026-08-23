/**
 * Where this installation's headless engine is, and what it was built from.
 *
 * From 0.3.1 the VSIX carries `dist-standalone/cline-core.js` — the SAME agent as the UI build, compiled
 * from a second entry point (`src/standalone/cline-core.ts`) over the same `src/core/**`. Anything that
 * drives the extension headlessly — the Knowledge Studio, an external agent over MCP — needs to find that
 * file and, more importantly, be able to SAY which build it drove. A run attributed to "the engine" and a
 * run attributed to `shipped 1aa09b4c v0.3.1` are not the same evidence.
 *
 * Pure: no `vscode` import, so it can be unit-tested and reused from the CLI side.
 */
import * as fs from "fs"
import * as path from "path"

export interface HeadlessEngineInfo {
	/** Absolute path to cline-core.js, or null when this install has no engine (a pre-0.3.1 VSIX). */
	corePath: string | null
	/** Extension version the engine was built from — from build-info.json, not guessed. */
	version: string | null
	/** Commit the engine was built from; null when built outside a git checkout. */
	sha: string | null
	/** The checkout had uncommitted changes at build time. A dev build, not a release. */
	dirty: boolean
	/** Production builds are minified AND have IS_DEV eliminated — see the caveat below. */
	minified: boolean
	builtAt: string | null
	/**
	 * `ADSUM_KBIT_LOCAL` (serving Knowledge bits from an authoring folder instead of the registry) is gated
	 * on `IS_DEV`, which a production build replaces with `false` at compile time. So the SHIPPED engine
	 * cannot serve folder bits — A/B ablation against unpublished bits needs an engine built from a
	 * checkout. Stated here so a caller can say why rather than watch an override silently do nothing.
	 */
	supportsFolderKbits: boolean
}

export const BUILD_INFO_FILE = "build-info.json"
export const ENGINE_SUBDIR = "dist-standalone"

/** Read the engine that ships inside an extension installation directory. */
export function headlessEngineAt(extensionPath: string): HeadlessEngineInfo {
	const dir = path.join(extensionPath, ENGINE_SUBDIR)
	const corePath = path.join(dir, "cline-core.js")
	const absent: HeadlessEngineInfo = {
		corePath: null,
		version: null,
		sha: null,
		dirty: false,
		minified: false,
		builtAt: null,
		supportsFolderKbits: false,
	}
	if (!fs.existsSync(corePath)) {
		return absent
	}
	let info: Record<string, unknown> = {}
	try {
		info = JSON.parse(fs.readFileSync(path.join(dir, BUILD_INFO_FILE), "utf8"))
	} catch {
		// An engine with no stamp is still runnable; it just cannot be attributed. Say so with nulls.
	}
	const minified = info.minified === true
	return {
		corePath,
		version: typeof info.version === "string" ? info.version : null,
		sha: typeof info.sha === "string" ? info.sha : null,
		dirty: info.dirty === true,
		minified,
		builtAt: typeof info.builtAt === "string" ? info.builtAt : null,
		supportsFolderKbits: !minified,
	}
}

/** A short, honest stamp for a run row: `shipped 1aa09b4c v0.3.1`. */
export function headlessEngineRef(info: HeadlessEngineInfo): string | null {
	if (!info.corePath) {
		return null
	}
	return `shipped ${String(info.sha ?? "?").slice(0, 8)}${info.dirty ? "-dirty" : ""} v${info.version ?? "?"}`
}
