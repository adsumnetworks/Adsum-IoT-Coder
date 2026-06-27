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
