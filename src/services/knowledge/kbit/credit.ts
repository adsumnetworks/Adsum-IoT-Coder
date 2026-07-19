/**
 * K-bit attribution — the credit facts the UI renders, and the derivation rules around them.
 *
 * Two hard rules this file exists to enforce:
 *
 *  1. ATTRIBUTION FACTS LIVE IN THE BIT, NOT HERE. Who curated a bit is curated knowledge; it belongs in
 *     the bit's frontmatter (and therefore the manifest), never in a host-side id→person table. This module
 *     only *reads* those fields and decides how to present them. If a bit is unattributed we say so honestly
 *     instead of guessing.
 *  2. THE LEAD SENTENCE IS DERIVED, NEVER AUTHORED. A per-bit marketing line would not scale to new bits and
 *     would put trust copy beyond the reach of the verdict-word lint. Instead a handful of templates slot in
 *     structured facts, and a clause only renders when the fact behind it exists — most importantly the
 *     hardware clause, which stays absent until a real witness record exists.
 *
 * Copy law (see the sprint's design/01): never "certified" / "verified" / "approved" / "passes" /
 * "guaranteed" / "compliant"; `tier` is never rendered; attribution is credit, never a verdict.
 */

/** A bit's kind as the user sees it. `tool` → "Tool bit" (⚙); everything else → "Knowledge bit" (◆). */
export type KbitKind = "knowledge" | "tool"

/** Hardware evidence for a bit. Absent until a real run witnesses it — never authored by hand. */
export interface KbitWitness {
	board: string
	toolchain?: string
	on?: string
}

export interface KbitCredit {
	id: string
	title: string
	kind: KbitKind
	/** Display name of the curator, or ATTRIBUTION_FALLBACK when the bit carries no personal attribution. */
	author: string
	/** True when `author` is a real person from the bit's metadata (drives whether the name is clickable). */
	attributed: boolean
	/** Co-authors, in declared order — people whose earlier work the current version stands on. Never
	 *  includes the lead author, and never a placeholder handle. Empty when the bit declares none. */
	contributors: string[]
	version?: string
	license?: string
	platform?: string
	steward: string
	witness?: KbitWitness
}

/** Shown when a bit carries no personal attribution. Honest: house-maintained, no individual claimed. */
export const ATTRIBUTION_FALLBACK = "Adsum authoring team"

/** Steward for every bit today (schema `owner` is an org enum like "adsum-core"). */
const STEWARD = "Adsum Networks"

/**
 * Placeholder author values that are NOT people. The corpus shipped with `author: adsum` on every bit as a
 * schema placeholder; rendering that as a credit would claim attribution nobody gave. Treat as unattributed
 * so an un-migrated bit degrades to the honest fallback instead of crediting a handle.
 */
const PLACEHOLDER_AUTHORS = new Set(["adsum", "adsum-core", "adsum networks", "unknown", "tbd", ""])

export interface KbitMetaLike {
	id?: string
	title?: string
	type?: string
	author?: string
	version?: string
	license?: string
	platform?: string
	owner?: string
	/** `contributors: A, B` or a YAML list. Manifest entries arrive parsed (array); the local frontmatter
	 *  reader hands back the raw scalar. Both shapes normalise to the same string[]. */
	contributors?: string | string[]
}

/** Build the credit facts for a bit from whatever metadata we have (manifest entry or parsed frontmatter). */
export function creditFromMeta(meta: KbitMetaLike, fallbackId?: string): KbitCredit {
	const id = meta.id || fallbackId || ""
	const raw = (meta.author || "").trim()
	const attributed = raw !== "" && !PLACEHOLDER_AUTHORS.has(raw.toLowerCase())
	return {
		id,
		title: meta.title?.trim() || titleFromId(id),
		kind: meta.type?.trim().toLowerCase() === "tool" ? "tool" : "knowledge",
		author: attributed ? raw : ATTRIBUTION_FALLBACK,
		attributed,
		version: meta.version?.trim() || undefined,
		license: meta.license?.trim() || undefined,
		platform: meta.platform?.trim() || undefined,
		steward: STEWARD,
		contributors: normalizeContributors(meta.contributors, attributed ? raw : undefined),
	}
}

/**
 * Co-authors, cleaned. Re-attributing a bit must not erase whoever wrote the version it grew out of — that
 * person keeps a credit here. Drops placeholders and the lead author (a name must never appear twice in one
 * credit line), and preserves declared order: earlier contributors first.
 */
function normalizeContributors(raw: string | string[] | undefined, lead: string | undefined): string[] {
	const list = Array.isArray(raw) ? raw : (raw ?? "").split(",")
	const out: string[] = []
	for (const entry of list) {
		const name = String(entry ?? "")
			.trim()
			.replace(/^["']|["']$/g, "")
		if (!name || PLACEHOLDER_AUTHORS.has(name.toLowerCase()) || name === lead || out.includes(name)) {
			continue
		}
		out.push(name)
	}
	return out
}

/** Last path segment of an id, humanised — only used when a bit has no title. */
function titleFromId(id: string): string {
	const leaf = id.split("/").filter(Boolean).pop() ?? id
	return leaf.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Minimal frontmatter field reader — scalar `key: value` only, quotes stripped. Deliberately not a YAML
 * parser: the runtime loaders must stay dependency-free (see frontmatter.ts), and every field we need is a
 * flat scalar. Block lists (requires/triggers) are not read here — they are not attribution.
 */
export function creditFieldsFromYaml(yaml: string): KbitMetaLike {
	const scalar = (key: string): string | undefined => {
		const m = yaml.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"))
		if (!m) {
			return undefined
		}
		const v = m[1].trim().replace(/^["']|["']$/g, "")
		return v === "" ? undefined : v
	}
	/** Reads BOTH `key: A, B` and a YAML block list under `key:` — the one place this reader goes past
	 *  scalars, because the alternative is silently dropping a person's credit when a bit uses list form. */
	const names = (key: string): string[] | undefined => {
		const inline = scalar(key)
		if (inline) {
			return inline.split(",")
		}
		const block = yaml.match(new RegExp(`^${key}:[ \\t]*$\\n((?:[ \\t]*-[ \\t]*.+\\n?)+)`, "m"))
		return block
			? block[1]
					.split("\n")
					.map((l) => l.replace(/^[ \t]*-[ \t]*/, ""))
					.filter(Boolean)
			: undefined
	}
	return {
		id: scalar("id"),
		title: scalar("title"),
		type: scalar("type"),
		author: scalar("author"),
		version: scalar("version"),
		license: scalar("license"),
		platform: scalar("platform"),
		owner: scalar("owner"),
		contributors: names("contributors"),
	}
}

// The derived lead SENTENCE was removed with the popover prose it fed: it restated the labelled rows
// beneath it (author appeared three times in one card) and read identically across every bit by the same
// author on the same platform. Provenance is now facts in rows; the witness clause it existed to carry
// became its own row. Kept in git history if prose is ever wanted again.
