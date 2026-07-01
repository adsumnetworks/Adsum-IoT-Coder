/**
 * NCS/Zephyr module → version resolver from the west manifest (CVE scan loop — design/16 §2, the version half the
 * curated PURL map needs). The real NCS SBOM carries no versions; west does. Two sources, both supported:
 *
 *   1. `west list -f '{name} {revision}'` output (RECOMMENDED) — resolves manifest imports, so it includes the
 *      zephyr modules NCS pulls in transitively. Plain text → no import-resolution guesswork.
 *   2. a flat `west.yml` (manifest.projects[]) — convenient but misses imported sub-manifests.
 *
 * Honesty: this only ever reports a version west actually pins — it never invents one. A revision that is a raw
 * commit SHA (not a tag/semver) is returned verbatim and flagged via `isLikelyVersion`, because OSV matches on
 * versions/tags, not commits, so a SHA-keyed PURL will honestly miss rather than mis-match.
 */
import { load as yamlLoad } from "js-yaml"
import { type ModuleVersionResolver, normalizeModuleName } from "./componentPurlMap"

/** Parse `west list -f '{name} {revision}'` output → { canonicalName: revision }. Tolerant of blank/extra cols. */
export function parseWestList(text: string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line) {
			continue
		}
		const [name, revision] = line.split(/\s+/)
		if (name && revision) {
			out[normalizeModuleName(name)] = revision
		}
	}
	return out
}

/** Parse a flat `west.yml` (manifest.projects[]) → { canonicalName: revision }. Misses imported sub-manifests. */
export function parseWestManifest(yamlText: string): Record<string, string> {
	let doc: unknown
	try {
		doc = yamlLoad(yamlText)
	} catch {
		return {}
	}
	const projects = (doc as { manifest?: { projects?: unknown } })?.manifest?.projects
	if (!Array.isArray(projects)) {
		return {}
	}
	const out: Record<string, string> = {}
	for (const p of projects as Array<Record<string, unknown>>) {
		const name = typeof p?.name === "string" ? p.name : ""
		const revision = typeof p?.revision === "string" ? p.revision : ""
		if (name && revision) {
			out[normalizeModuleName(name)] = revision
		}
	}
	return out
}

/** Heuristic: does a revision look like a version/tag OSV can match (vs a raw 40-hex commit SHA)? */
export function isLikelyVersion(revision: string): boolean {
	if (/^[0-9a-f]{40}$/i.test(revision)) {
		return false // full commit SHA — OSV won't match it to a version range
	}
	return /\d/.test(revision) // a tag/semver carries a digit (v2.1.0, 3.6.5, TF-Mv2.2.0, hostap_2_11)
}

/**
 * Parse the ESP-IDF core SEMVER from a `build/project_description.json` text — the ESP analogue of reading
 * `zephyr/VERSION`. `git_revision` carries the IDF tag (e.g. "v6.0.1") on every build; `idf_version` exists only
 * on some IDF versions (absent in v6.0.1) — prefer git_revision, fall back to idf_version. Returns the bare semver
 * ("6.0.1") or undefined (not an ESP build / no tag — a dev checkout between tags resolves to undefined honestly).
 * Ground-truthed 2026-06-28 against a real esp-idf v6.0.1 build (only git_revision held the version).
 */
export function parseEspIdfVersion(projectDescriptionJson: string): string | undefined {
	try {
		const pd = JSON.parse(projectDescriptionJson)
		const raw =
			(typeof pd?.git_revision === "string" ? pd.git_revision : undefined) ??
			(typeof pd?.idf_version === "string" ? pd.idf_version : undefined)
		// "v6.0.1" / "v5.3.1-dirty" → "6.0.1" / "5.3.1" (semver prefix only; drop the leading v + any -suffix).
		return raw?.match(/^v?(\d+\.\d+(?:\.\d+)?)/)?.[1]
	} catch {
		return undefined
	}
}

/**
 * Parse the Zephyr core SEMVER from a build's generated `version.h`
 * (`<build>/zephyr/include/generated/zephyr/version.h` or `.../generated/version.h`). This is the version the build
 * ACTUALLY compiled, and it lives in the build output — so it survives a sample copied OUT of the west workspace
 * (the demo builds central_uart in /tmp, where `west topdir` finds no `.west/`). Prefers `KERNEL_VERSION_STRING`,
 * falls back to the MAJOR/MINOR/PATCHLEVEL triple. Returns "4.2.99" or undefined (no build / unparsable).
 */
export function parseZephyrVersionH(versionH: string): string | undefined {
	const s = versionH.match(/KERNEL_VERSION_STRING\s+"([0-9]+\.[0-9]+(?:\.[0-9]+)?)"/)
	if (s) {
		return s[1]
	}
	const maj = versionH.match(/KERNEL_VERSION_MAJOR\s+(\d+)/)?.[1]
	const min = versionH.match(/KERNEL_VERSION_MINOR\s+(\d+)/)?.[1]
	const pat = versionH.match(/KERNEL_PATCHLEVEL\s+(\d+)/)?.[1]
	return maj && min ? `${maj}.${min}.${pat ?? "0"}` : undefined
}

/**
 * Build a `ModuleVersionResolver` from a version table (from `parseWestList` / `parseWestManifest`). Returns a
 * version only when west pins one that looks matchable; a commit-SHA revision → undefined (honest miss, not a
 * mis-match). Pass the result as `resolveModuleVersion` to `runCveScan` / `runCveScanHost`.
 */
export function makeModuleVersionResolver(versions: Record<string, string>): ModuleVersionResolver {
	return (moduleName: string) => {
		const rev = versions[normalizeModuleName(moduleName)]
		return rev && isLikelyVersion(rev) ? rev : undefined
	}
}
