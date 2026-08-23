/**
 * CLI entry for the `cve-scan` Tool bit.
 *
 * The CRA scan engine used to be linked into the extension, which meant its two curated tables — the
 * advisory hints and the PURL map — could only be corrected by shipping a VSIX. CVEs land weekly and
 * releases do not, so the engine is a Tool bit now and those tables travel with it.
 *
 * The seam was already here: the handler injected the whole scan behind one `scan()` dependency, so
 * what moves is that function's body plus the `west`/`git` discovery it called. Closures cannot cross
 * a process boundary, so the tool owns all of it: it runs `west list`, `west topdir`, `git merge-base`
 * and `nm` itself, and the host passes only paths, a date and an environment.
 *
 * What deliberately did NOT move, and must not:
 *   - `reportIntegrity` — the guard that stops a report claiming a CVE count it did not earn. A guard
 *     that arrives over the wire is not a guard.
 *   - the applicability hedge wording — the host's home-of-record (D11-R). The tool emits a signal and
 *     structured evidence; the host writes the sentence.
 *   - the triage counts — recomputed host-side AFTER any hint-derived exclusion is downgraded, so a
 *     bad table cannot quietly shrink "not reachable".
 *
 * Contract:
 *   node cve_scan.mjs --sbom <abs> [--build <abs>] [--project <abs>] --as-of YYYY-MM-DD [--nm <bin>]
 *   stdout: one JSON document (see ENVELOPE below)
 *   exit 0  a result exists, possibly partial (a dead source is reported, never silently dropped)
 *   exit 2  bad input — no SBOM, unreadable SBOM. Surfaced verbatim; it is NOT "tool unavailable".
 *   exit 3  internal failure, including a Node too old to have global fetch
 *
 * Progress does not cross the boundary. The handler deliberately shows ONE non-partial progress say
 * with a client-side timer, after fire-and-forget partial says lost the race and left the spinner
 * unpainted. Streaming phases back would invite that regression, so the tool stays quiet.
 *
 * Secrets travel in the ENVIRONMENT, never argv: NVDAPIKEY would otherwise be visible in `ps` and in
 * any echoed command line.
 */

import { execFile } from "node:child_process"
import { existsSync, readFileSync, writeSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { resolveAdvisoryHint } from "./advisoryHints"
import { defaultBuildEvidenceReaders } from "./buildEvidence"
import { type ModuleVersionResolver, normalizeModuleName } from "./componentPurlMap"
import { runCveScanHost } from "./cveScanHost"
import { discoverByProduct, EUVD_DISCOVER_MIN_SCORE, type EuvdRecord, makeEuvdFetcher } from "./euvdFetcher"
import { makeOsvFixCommitResolver } from "./fixCommitResolver"
import { type ModuleRefsResolver, type ModuleSecurityRefs, readModuleSecurityRefs } from "./moduleSecurityRefs"
import { makeNvdFetcher } from "./nvdFetcher"
import { makeOsvFetcher } from "./osvFetcher"
import type { ScanLoopResult } from "./scanLoop"
import {
	makeModuleVersionResolver,
	parseEspIdfVersion,
	parseWestList,
	parseWestManifest,
	parseZephyrVersionH,
} from "./westVersions"

const execFileAsync = promisify(execFile)

/**
 * Candidate working dirs to run `west` from, most-likely-a-west-workspace first. `west` walks up to find
 * `.west/`, so the project SOURCE dir is the best bet — NOT the build dir (a `build/` tree is not a workspace,
 * and a project copied outside the SDK tree has no workspace at all). This was the 2706g bug: every `west list`
 * ran in `build/` and silently returned nothing, so F5 enrichment never engaged. Falls back to the build dir +
 * its parent. De-dupes, drops undefined, preserves order.
 */
function westCwdCandidates(projectDir?: string, buildDir?: string): string[] {
	const out: string[] = []
	for (const c of [projectDir, buildDir, buildDir ? path.join(buildDir, "..") : undefined]) {
		if (c && !out.includes(c)) {
			out.push(c)
		}
	}
	return out
}

/**
 * Build a module→version resolver for the CVE scan's curated PURL enrichment (F5). Prefers `west list`
 * (resolves manifest imports → the actual pinned revisions of the security-relevant modules), then a flat
 * west.yml. Tries each candidate cwd (project dir first — see westCwdCandidates) until one resolves inside a
 * workspace. Returns undefined if none is reachable — the scan then runs without enrichment, exactly as before
 * (no regression). Never throws. (west list is read-only; fixed args; no shell interpolation.)
 */
async function resolveWestModuleVersions(projectDir?: string, buildDir?: string) {
	for (const cwd of westCwdCandidates(projectDir, buildDir)) {
		try {
			const { stdout } = await execFileAsync("west", ["list", "-f", "{name} {revision}"], {
				cwd,
				timeout: 15_000,
				maxBuffer: 4 * 1024 * 1024,
			})
			const versions = parseWestList(stdout)
			if (Object.keys(versions).length > 0) {
				return makeModuleVersionResolver(versions)
			}
		} catch {
			// `west` not on PATH / not a west workspace from here — try the next candidate cwd.
		}
	}
	for (const candidate of [
		projectDir ? path.join(projectDir, "west.yml") : undefined,
		buildDir ? path.join(buildDir, "..", "west.yml") : undefined,
		buildDir ? path.join(buildDir, "west.yml") : undefined,
	]) {
		if (!candidate) {
			continue
		}
		try {
			const versions = parseWestManifest(readFileSync(candidate, "utf8"))
			if (Object.keys(versions).length > 0) {
				return makeModuleVersionResolver(versions)
			}
		} catch {
			// not at this path — try the next candidate.
		}
	}
	return undefined
}

/**
 * Build a module→security-refs resolver (F5) from each west module's `zephyr/module.yml`
 * `security: external-references` — the vendor-declared CPE/PURL. Lets the CPE→NVD path work even when the SBOM
 * tool didn't emit CPEs. Uses `west list -f '{name} {abspath}'` from the project workspace (tries each candidate
 * cwd — see westCwdCandidates); returns undefined if west is unavailable or no module declares refs (scan then
 * runs without module.yml enrichment — no regression). Never throws.
 */
async function resolveWestModuleRefs(projectDir?: string, buildDir?: string): Promise<ModuleRefsResolver | undefined> {
	let stdout: string | undefined
	for (const cwd of westCwdCandidates(projectDir, buildDir)) {
		try {
			const res = await execFileAsync("west", ["list", "-f", "{name} {abspath}"], {
				cwd,
				timeout: 15_000,
				maxBuffer: 4 * 1024 * 1024,
			})
			stdout = res.stdout
			break
		} catch {
			// west not on PATH / not a west workspace from here — try the next candidate cwd.
		}
	}
	if (stdout === undefined) {
		return undefined
	}
	const map = new Map<string, ModuleSecurityRefs>()
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim()
		const sp = trimmed.indexOf(" ")
		if (sp < 0) {
			continue
		}
		const name = trimmed.slice(0, sp)
		const modPath = trimmed.slice(sp + 1).trim()
		const refs =
			readModuleSecurityRefs(path.join(modPath, "zephyr", "module.yml")) ??
			readModuleSecurityRefs(path.join(modPath, "module.yml"))
		if (refs && (refs.cpes.length > 0 || refs.purls.length > 0)) {
			map.set(normalizeModuleName(name), refs)
		}
	}
	if (map.size === 0) {
		return undefined
	}
	return (componentName) => map.get(componentName)
}

/**
 * Resolve the platform CORE versions as **semvers** from the SDK itself — NOT the git SHA the SBOM records (which
 * doesn't version-match). Covers both platforms:
 *  - **Zephyr** (nRF/NCS): `west topdir` → `<topdir>/zephyr/VERSION` → "MAJOR.MINOR.PATCHLEVEL".
 *  - **esp-idf** (ESP): `<buildDir>/project_description.json` → `idf_version` (e.g. "v6.0.1" → "6.0.1").
 * This is the key that makes the cores (the biggest components, tagged with no CPE by `west spdx`/`esp-idf-sbom`)
 * detectable: a curated CPE + this semver → CPE→NVD finds their CVEs, and it signals which platform to query for
 * EUVD discover-by-product. Returns a resolver mapping the core name → semver (or undefined if neither resolves,
 * so the scan runs without core enrichment — no regression). Never throws.
 */
async function resolveCoreVersions(projectDir?: string, buildDir?: string): Promise<ModuleVersionResolver | undefined> {
	const cores = new Map<string, string>()

	// Zephyr (nRF/NCS) — PRIMARY: the build's generated version.h. It carries the version the build actually
	// compiled and lives in the build OUTPUT, so it survives a sample copied OUT of the west workspace (the demo
	// builds central_uart in /tmp, where `west topdir` finds no `.west/` → the 2806i bug: the Zephyr core never got
	// its CPE). The build dir is already required for .config/ELF evidence, so it's reliably present.
	for (const dir of [buildDir, projectDir ? path.join(projectDir, "build") : undefined]) {
		if (!dir || cores.has("zephyr")) {
			continue
		}
		for (const rel of ["zephyr/include/generated/zephyr/version.h", "zephyr/include/generated/version.h"]) {
			try {
				const v = parseZephyrVersionH(readFileSync(path.join(dir, rel), "utf8"))
				if (v) {
					cores.set("zephyr", v)
					break
				}
			} catch {
				// not at this candidate — try the next.
			}
		}
	}
	// Zephyr FALLBACK: west topdir → zephyr/VERSION (for an in-workspace project with no build dir handy).
	if (!cores.has("zephyr")) {
		let topdir: string | undefined
		for (const cwd of westCwdCandidates(projectDir, buildDir)) {
			try {
				const { stdout } = await execFileAsync("west", ["topdir"], { cwd, timeout: 15_000 })
				const t = stdout.trim()
				if (t) {
					topdir = t
					break
				}
			} catch {
				// west not on PATH / not a workspace from here — try the next candidate.
			}
		}
		if (topdir) {
			try {
				const txt = readFileSync(path.join(topdir, "zephyr", "VERSION"), "utf8")
				const maj = txt.match(/VERSION_MAJOR\s*=\s*(\d+)/)?.[1]
				const min = txt.match(/VERSION_MINOR\s*=\s*(\d+)/)?.[1]
				const pat = txt.match(/PATCHLEVEL\s*=\s*(\d+)/)?.[1]
				if (maj && min) {
					cores.set("zephyr", `${maj}.${min}.${pat ?? "0"}`)
				}
			} catch {
				// no zephyr/VERSION at the topdir — leave the core unversioned (honest gap).
			}
		}
	}

	// esp-idf (ESP): the build's project_description.json records the exact IDF version it built against.
	for (const dir of [buildDir, projectDir ? path.join(projectDir, "build") : undefined]) {
		if (!dir || cores.has("esp-idf")) {
			continue
		}
		try {
			const idf = parseEspIdfVersion(readFileSync(path.join(dir, "project_description.json"), "utf8"))
			if (idf) {
				cores.set("esp-idf", idf)
			}
		} catch {
			// no project_description.json / not an ESP build here — honest gap.
		}
	}

	if (cores.size === 0) {
		return undefined
	}
	return (name) => cores.get(name)
}

/**
 * P2 (design/30): resolve the detected SDK's CORE git source tree — Zephyr (`<west topdir>/zephyr`) or esp-idf
 * (`idf_path` from project_description.json). This is the repo the fix-commit check (`git merge-base
 * --is-ancestor`) runs against. Platform-neutral: returns the first tree found, or undefined (no fix-commit check).
 */
async function resolveCoreSourceTree(projectDir?: string, buildDir?: string): Promise<string | undefined> {
	for (const cwd of westCwdCandidates(projectDir, buildDir)) {
		try {
			const { stdout } = await execFileAsync("west", ["topdir"], { cwd, timeout: 15_000 })
			const t = stdout.trim()
			if (t && existsSync(path.join(t, "zephyr"))) {
				return path.join(t, "zephyr")
			}
		} catch {
			// west not on PATH / not a workspace — try the next candidate.
		}
	}
	for (const dir of [buildDir, projectDir ? path.join(projectDir, "build") : undefined]) {
		if (!dir) {
			continue
		}
		try {
			const pd = JSON.parse(readFileSync(path.join(dir, "project_description.json"), "utf8"))
			if (typeof pd?.idf_path === "string" && existsSync(pd.idf_path)) {
				return pd.idf_path
			}
		} catch {
			// not an ESP build here.
		}
	}
	return undefined
}

/**
 * P2: is an upstream fix commit present in the source tree? `git -C <tree> merge-base --is-ancestor <sha> HEAD` —
 * exit 0 = present (patched) → true; exit 1 = absent → false; anything else (bad SHA, shallow clone, not a repo) →
 * undefined (couldn't determine → the engine hedges, never a false claim). Read-only, fixed args, no shell.
 */
async function gitFixPresent(treeDir: string, fixSha: string): Promise<boolean | undefined> {
	try {
		await execFileAsync("git", ["-C", treeDir, "merge-base", "--is-ancestor", fixSha, "HEAD"], { timeout: 10_000 })
		return true
	} catch (e) {
		return (e as { code?: number })?.code === 1 ? false : undefined
	}
}

/** The scan, exactly as the host used to run it in-process. */
async function runScan({
	sbomPath,
	buildDir,
	projectDir,
	asOf,
}: {
	sbomPath: string
	buildDir?: string
	projectDir?: string
	asOf: string
}): Promise<ScanLoopResult> {
	// Resolve the core SEMVERs once (zephyr/VERSION or esp-idf project_description.json, not the SHA): enables
	// curated-CPE NVD detection of the core AND signals which platform to query for EUVD discover-by-product.
	const coreResolver = await resolveCoreVersions(projectDir, buildDir)
	const zephyrVer = coreResolver?.("zephyr")
	const espVer = coreResolver?.("esp-idf")
	// EUVD discover-by-product for the detected SDK — the EU-authoritative catch for core CVEs NVD's CPE configs
	// miss. One platform per build; Zephyr → zephyrproject/zephyr, ESP → espressif/esp-idf (both EUVD-verified).
	const euvdProduct: { fetch: () => Promise<EuvdRecord[]>; label: string } | undefined = zephyrVer
		? {
				fetch: () => discoverByProduct("zephyrproject", "zephyr", undefined, { fromScore: EUVD_DISCOVER_MIN_SCORE }),
				label: `zephyr ${zephyrVer}`,
			}
		: espVer
			? {
					fetch: () => discoverByProduct("espressif", "esp-idf", undefined, { fromScore: EUVD_DISCOVER_MIN_SCORE }),
					label: `esp-idf ${espVer}`,
				}
			: undefined
	// P2: the detected SDK's core git tree (Zephyr / esp-idf) — fix-commit checks run here. Resolved once.
	const sourceTree = await resolveCoreSourceTree(projectDir, buildDir)
	return runCveScanHost(
		{ sbomPath, buildDir },
		{
			fetcher: makeOsvFetcher(),
			readers: defaultBuildEvidenceReaders(),
			resolveHint: resolveAdvisoryHint,
			asOf,
			// P2 (design/30): is a CVE's upstream fix commit already backported into the source tree? → "patched".
			fixCommitChecker: sourceTree ? (sha) => gitFixPresent(sourceTree, sha) : undefined,
			// P2 auto-discovery: when no curated SHA, pull the fix commit from OSV's GIT range (API-resilient).
			fixCommitResolver: sourceTree ? makeOsvFixCommitResolver() : undefined,
			// F5: enrich PURL-sparse west SBOMs with curated coordinates keyed on the real module versions.
			resolveModuleVersion: await resolveWestModuleVersions(projectDir, buildDir),
			// F5: fill CPE/PURL the SBOM tool didn't emit, from each module's own zephyr/module.yml.
			resolveModuleRefs: await resolveWestModuleRefs(projectDir, buildDir),
			// Platform-core CPE detection: the curated CPE map makes the Zephyr core — the biggest component,
			// untagged by west spdx — NVD-detectable, keyed on its semver.
			resolveCoreVersion: coreResolver,
			// F11: also scan CPE-bearing components against NVD — the path that finds CVEs OSV misses for
			// embedded C libs (mbed TLS et al.). Offline-safe degradation: a network error throws and is
			// surfaced as "scan unavailable", never a false-clean.
			nvdFetcher: makeNvdFetcher(),
			// EUVD (CORE — the CRA's named DB): confirm each matched CVE → EUVD id + EPSS + KEV.
			euvdFetcher: makeEuvdFetcher(),
			// EUVD discover-by-product (CORE): for the detected SDK, list the EU DB's high-severity advisories —
			// the CRA-authoritative catch for CVEs NVD's CPE configs miss (e.g. CVE-2025-10456 on Zephyr,
			// esp-idf core CVEs on ESP). Hedged, version-not-confirmed candidates. Wired for both platforms.
			euvdProductFetcher: euvdProduct?.fetch,
			euvdProductLabel: euvdProduct?.label,
			// `source` is derived by the scan loop from the fetchers actually wired (D1) — not hard-coded here.
		},
	)

}


// ── the envelope ─────────────────────────────────────────────────────────────

/**
 * `ScanLoopResult` carries a Map (`enrichment`), which JSON.stringify silently turns into `{}`. Losing
 * it would drop every severity and fixed-version the enrichment pass found — a quiet downgrade of the
 * report's quality with nothing to notice. So it is serialised explicitly and rehydrated host-side.
 */
function serialise(r: ScanLoopResult) {
	return {
		schema: "adsum.cve-scan-tool/1",
		status: "ok" as const,
		result: {
			...r,
			enrichment: [...r.enrichment.entries()],
		},
	}
}

function emit(payload: unknown, code: number): void {
	// writeSync, not console.log + process.exit: a large scan result exceeds the pipe buffer, and
	// exiting before it drains delivers truncated JSON with a success status.
	writeSync(code === 0 ? 1 : 1, `${JSON.stringify(payload, null, 2)}\n`)
	process.exitCode = code
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2)
	const opt = (n: string): string | undefined => {
		const i = argv.indexOf(`--${n}`)
		return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined
	}

	if (argv.includes("--help") || argv.includes("-h")) {
		writeSync(1, "cve-scan --sbom <path> [--build <dir>] [--project <dir>] --as-of YYYY-MM-DD\n")
		return
	}
	// A Node without global fetch cannot query any of the three databases, and a scan that silently
	// queried none of them would report a clean bill of health it never earned.
	if (typeof fetch !== "function") {
		emit({ schema: "adsum.cve-scan-tool/1", status: "internal-error", reason: "cve-scan requires Node 18+ (no global fetch)" }, 3)
		return
	}

	const sbomPath = opt("sbom")
	if (!sbomPath) {
		emit({ schema: "adsum.cve-scan-tool/1", status: "bad-input", reason: "--sbom <path> is required" }, 2)
		return
	}
	// Required, never defaulted to today: the artifact filename and the attribution dates are derived
	// from it, and a tool that picked its own date could disagree with the report it feeds.
	const asOf = opt("as-of")
	if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
		emit({ schema: "adsum.cve-scan-tool/1", status: "bad-input", reason: "--as-of YYYY-MM-DD is required" }, 2)
		return
	}

	try {
		const result = await runScan({ sbomPath, buildDir: opt("build"), projectDir: opt("project"), asOf })
		emit(serialise(result), 0)
	} catch (e) {
		const message = (e as Error)?.message ?? String(e)
		// The no-SBOM error is deliberately a hard, quotable sentence from cveScanHost — it tells the
		// developer to generate an SBOM first. Mapping it to "tool unavailable" would send them hunting
		// for a tooling problem they do not have.
		const badInput = /could not read the sbom/i.test(message)
		emit(
			{ schema: "adsum.cve-scan-tool/1", status: badInput ? "bad-input" : "internal-error", reason: message },
			badInput ? 2 : 3,
		)
	}
}

main()
