/**
 * Read the vendor-declared CPE/PURL identifiers for Zephyr/NCS modules from their `zephyr/module.yml`
 * `security: external-references` block — the **authoritative** enrichment source (per the Nordic/Zephyr docs:
 * "the module description file can be used to improve vulnerability monitoring … CPE … PURL").
 *
 * This replaces a hand-maintained component→PURL map: each module declares its own
 *   security:
 *     external-references:
 *       - cpe:2.3:a:arm:mbed_tls:3.5.2:*:*:*:*:*:*:*   # → NVD (the CPE→NVD path, F11)
 *       - pkg:github/Mbed-TLS/mbedtls@3.5.2            # → OSV / GitHub Advisory (the PURL path)
 * so the SBOM can be enriched from ground truth in the installed NCS tree rather than our guesses.
 *
 * `parseModuleSecurityRefs` is pure (text → refs) and fixture-testable; `readModuleSecurityRefs` is the thin
 * host wrapper that reads one file. The tree-walk (which module.yml files to read) is the caller's job.
 */
import { readFileSync } from "node:fs"
import { load as yamlLoad } from "js-yaml"
import { normalizeModuleName } from "./componentPurlMap"
import { classifyComponent, type NormalizedSbom, type SbomComponent } from "./sbomNormalize"

export interface ModuleSecurityRefs {
	/** Module name from the module.yml `name:` field, if present. */
	name?: string
	/** `cpe:2.3:…` references — the NVD match keys. */
	cpes: string[]
	/** `pkg:…` references — the OSV / GitHub Advisory match keys. */
	purls: string[]
}

const EMPTY: ModuleSecurityRefs = { cpes: [], purls: [] }

/** Parse one `zephyr/module.yml`'s text → its declared security references. Never throws. */
export function parseModuleSecurityRefs(moduleYmlText: string): ModuleSecurityRefs {
	let doc: unknown
	try {
		doc = yamlLoad(moduleYmlText)
	} catch {
		return EMPTY
	}
	const root = doc as { name?: unknown; security?: { "external-references"?: unknown } } | null
	const refs = root?.security?.["external-references"]
	if (!Array.isArray(refs)) {
		return { name: typeof root?.name === "string" ? root.name : undefined, cpes: [], purls: [] }
	}
	const cpes: string[] = []
	const purls: string[] = []
	for (const r of refs) {
		if (typeof r !== "string") {
			continue
		}
		const s = r.trim()
		if (/^cpe:/i.test(s)) {
			cpes.push(s)
		} else if (/^pkg:/i.test(s)) {
			purls.push(s)
		}
	}
	return { name: typeof root?.name === "string" ? root.name : undefined, cpes, purls }
}

/** Read + parse a single `zephyr/module.yml`. Returns null if unreadable (caller skips it). */
export function readModuleSecurityRefs(moduleYmlPath: string): ModuleSecurityRefs | null {
	try {
		return parseModuleSecurityRefs(readFileSync(moduleYmlPath, "utf8"))
	} catch {
		return null
	}
}

/** Canonical-module-name → its declared security refs, or undefined. */
export type ModuleRefsResolver = (componentName: string) => ModuleSecurityRefs | undefined

/**
 * Fill missing CPE/PURL on SBOM components from vendor `module.yml` refs (the authoritative source), over a
 * copy, re-deriving coverage. Tool-emitted ids always win (never overwritten) — we only fill blanks. This is
 * what lets the CPE→NVD path work even when the SBOM tool didn't emit CPEs (older `ncs-sbom`): the module
 * declares its own `cpe:2.3:…`. Coverage's `queryable`/drop-reasons are recomputed honestly.
 */
export function applyModuleRefs(sbom: NormalizedSbom, resolve: ModuleRefsResolver): NormalizedSbom {
	const components: SbomComponent[] = sbom.components.map((c) => {
		const refs = resolve(normalizeModuleName(c.name))
		if (!refs) {
			return c
		}
		// D5 (design/25): a module may declare several CPEs/PURLs — prefer a VERSIONED one (it actually version-matches)
		// over whatever happens to be first; fall back to [0] if none carry a version.
		const cpe = c.cpe ?? refs.cpes.find((x) => /^cpe:2\.3(?::[^:]*){5}:[^:*][^:]*/i.test(x)) ?? refs.cpes[0]
		const purl = c.purl ?? refs.purls.find((x) => /@/.test(x)) ?? refs.purls[0]
		if (cpe === c.cpe && purl === c.purl) {
			return c
		}
		const filled: SbomComponent = { ...c, cpe, purl, purlSource: c.purl ? c.purlSource : purl ? "curated" : c.purlSource }
		const verdict = classifyComponent(filled)
		filled.queryable = verdict.queryable
		filled.dropReason = verdict.dropReason
		return filled
	})

	const byDropReason: NormalizedSbom["coverage"]["byDropReason"] = {}
	let queryable = 0
	let withPurl = 0
	let withCpe = 0
	let unidentified = 0
	for (const c of components) {
		if (c.purl) {
			withPurl++
		}
		if (c.cpe) {
			withCpe++
		}
		if (!c.purl && !c.cpe) {
			unidentified++
		}
		if (c.queryable) {
			queryable++
		} else if (c.dropReason) {
			byDropReason[c.dropReason] = (byDropReason[c.dropReason] ?? 0) + 1
		}
	}
	return { components, coverage: { total: components.length, withPurl, withCpe, unidentified, queryable, byDropReason } }
}
