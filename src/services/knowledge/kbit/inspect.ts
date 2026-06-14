import type { KBitMeta } from "./schema"

/**
 * Pure catalog/inspection helpers for the `kbit ls|tree|show` CLI (scripts/kbit.ts) — the P1 local
 * operator visibility (design: target-architecture/06 §E). No filesystem here; the CLI reads
 * manifest.json + git dates and feeds them in, so all formatting is unit-testable.
 */

/** A manifest.json entry: the bit's frontmatter plus the generated path + content_hash. */
export type ManifestEntry = KBitMeta & { path: string; content_hash: string }

/** Parse manifest.json text → the bit entries (empty array if absent/malformed-shape). */
export function loadCatalog(manifestJson: string): ManifestEntry[] {
	const data = JSON.parse(manifestJson) as { bits?: ManifestEntry[] }
	return data.bits ?? []
}

export type CatalogFilter = { platform?: string; type?: string; tier?: string; status?: string }

/** Filter entries by any combination of platform/type/tier/status (status absent ⇒ "published"). */
export function filterEntries(entries: ManifestEntry[], f: CatalogFilter = {}): ManifestEntry[] {
	return entries.filter(
		(e) =>
			(!f.platform || e.platform === f.platform) &&
			(!f.type || e.type === f.type) &&
			(!f.tier || e.tier === f.tier) &&
			(!f.status || (e.status ?? "published") === f.status),
	)
}

/** One-line-per-bit catalog (for `kbit ls`). */
export function formatCatalog(entries: ManifestEntry[]): string {
	if (!entries.length) {
		return "(no bits)"
	}
	const rows = entries
		.slice()
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((e) => `  ${e.id}  [${e.type} · v${e.version} · ${e.tier} · ${e.status ?? "published"}]`)
	return `${entries.length} bits\n${rows.join("\n")}`
}

/** Grouped tree: platform → type → entries (for `kbit tree`). */
export type CatalogTree = Record<string, Record<string, ManifestEntry[]>>

export function buildTree(entries: ManifestEntry[]): CatalogTree {
	const tree: CatalogTree = {}
	for (const e of entries) {
		const plat = e.platform ?? "universal"
		tree[plat] ??= {}
		;(tree[plat][e.type] ??= []).push(e)
	}
	return tree
}

export function formatTree(entries: ManifestEntry[]): string {
	const tree = buildTree(entries)
	const out: string[] = []
	for (const plat of Object.keys(tree).sort()) {
		out.push(plat)
		for (const type of Object.keys(tree[plat]).sort()) {
			out.push(`  ${type}/`)
			for (const e of tree[plat][type].slice().sort((a, b) => a.id.localeCompare(b.id))) {
				out.push(
					`    ${e.id.split("/").pop()}  (v${e.version}${e.status && e.status !== "published" ? ` · ${e.status}` : ""})`,
				)
			}
		}
	}
	return out.join("\n")
}

/** Full per-bit detail (for `kbit show <id>`). `gitDates` (from the CLI) fill created/updated when absent. */
export function formatBitDetail(e: ManifestEntry, gitDates?: { created?: string; updated?: string }): string {
	const lines: string[] = [e.id]
	const add = (k: string, v?: string) => {
		if (v) {
			lines.push(`  ${`${k}:`.padEnd(15)}${v}`)
		}
	}
	add("title", e.title)
	add("type", e.type)
	add("version", e.version)
	add("status", e.status ?? "published")
	add("owner", e.owner)
	add("author", e.author)
	if (e.co_authors?.length) {
		add("co-authors", e.co_authors.map((c) => c.name ?? c.handle).join(", "))
	}
	if (e.endorsers?.length) {
		add(
			"endorsers",
			e.endorsers
				.map(
					(en) =>
						`${en.name ?? en.handle}${en.affiliation ? ` (${en.affiliation})` : ""} — v${en.version} ${en.verified ? "[verified]" : "[unverified]"}`,
				)
				.join("; "),
		)
	}
	if (e.supporters?.length) {
		add("supporters", e.supporters.map((s) => `${s.name ?? s.handle} [${s.kind}]`).join(", "))
	}
	add("license", e.license)
	add("tier", e.tier)
	add("delivery", e.delivery)
	add("platform", e.platform)
	add("created", e.created ?? gitDates?.created)
	add("updated", e.updated ?? gitDates?.updated)
	if (e.requires?.length) {
		add("requires", e.requires.join(", "))
	}
	if (e.loaded_by?.length) {
		add("loaded_by", e.loaded_by.join(", "))
	}
	add("path", e.path)
	add("content_hash", e.content_hash ? `${e.content_hash.slice(0, 12)}…` : undefined)
	return lines.join("\n")
}
