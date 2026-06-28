import { execFile } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
import { resolveAdvisoryHint } from "@/services/cra/advisoryHints"
import { defaultBuildEvidenceReaders } from "@/services/cra/buildEvidence"
import { type ModuleVersionResolver, normalizeModuleName } from "@/services/cra/componentPurlMap"
import { runCveScanHost } from "@/services/cra/cveScanHost"
import { makeEuvdFetcher } from "@/services/cra/euvdFetcher"
import { type ModuleRefsResolver, type ModuleSecurityRefs, readModuleSecurityRefs } from "@/services/cra/moduleSecurityRefs"
import { makeNvdFetcher } from "@/services/cra/nvdFetcher"
import { makeOsvFetcher } from "@/services/cra/osvFetcher"
import type { ScanLoopResult } from "@/services/cra/scanLoop"
import { makeModuleVersionResolver, parseWestList, parseWestManifest } from "@/services/cra/westVersions"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

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
 * doesn't version-match). Today: Zephyr, via `west topdir` → `<topdir>/zephyr/VERSION` → "MAJOR.MINOR.PATCHLEVEL".
 * This is the key that makes the Zephyr core (the biggest component, tagged with no CPE by `west spdx`)
 * detectable: a curated CPE + this semver → CPE→NVD finds its CVEs. Returns undefined if unresolvable (scan runs
 * without core-CPE enrichment — no regression). Never throws. (esp-idf added in the ESP-IDF phase.)
 */
async function resolveCoreVersions(projectDir?: string, buildDir?: string): Promise<ModuleVersionResolver | undefined> {
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
	if (!topdir) {
		return undefined
	}
	try {
		const txt = readFileSync(path.join(topdir, "zephyr", "VERSION"), "utf8")
		const maj = txt.match(/VERSION_MAJOR\s*=\s*(\d+)/)?.[1]
		const min = txt.match(/VERSION_MINOR\s*=\s*(\d+)/)?.[1]
		const pat = txt.match(/PATCHLEVEL\s*=\s*(\d+)/)?.[1]
		if (maj && min) {
			const semver = `${maj}.${min}.${pat ?? "0"}`
			return (name) => (name === "zephyr" ? semver : undefined)
		}
	} catch {
		// no zephyr/VERSION at the topdir — leave the core unversioned (honest gap).
	}
	return undefined
}

/** Injectable seams (network/fs/clock) so execute() is unit-testable; production uses the real defaults. */
export interface CveScanHandlerDeps {
	scan: (args: { sbomPath: string; buildDir?: string; projectDir?: string; asOf: string }) => Promise<ScanLoopResult>
	mkdir: (dir: string) => void
	writeFile: (filePath: string, content: string) => void
	now: () => string
}

const defaultDeps: CveScanHandlerDeps = {
	scan: async ({ sbomPath, buildDir, projectDir, asOf }) =>
		runCveScanHost(
			{ sbomPath, buildDir },
			{
				fetcher: makeOsvFetcher(),
				readers: defaultBuildEvidenceReaders(),
				resolveHint: resolveAdvisoryHint,
				asOf,
				// F5: enrich PURL-sparse west SBOMs with curated coordinates keyed on the real module versions.
				resolveModuleVersion: await resolveWestModuleVersions(projectDir, buildDir),
				// F5: fill CPE/PURL the SBOM tool didn't emit, from each module's own zephyr/module.yml.
				resolveModuleRefs: await resolveWestModuleRefs(projectDir, buildDir),
				// Platform-core CPE detection: resolve the Zephyr core's SEMVER (zephyr/VERSION, not the SHA) so the
				// curated CPE map makes the core — the biggest component, untagged by west spdx — NVD-detectable.
				resolveCoreVersion: await resolveCoreVersions(projectDir, buildDir),
				// F11: also scan CPE-bearing components against NVD — the path that finds CVEs OSV misses for
				// embedded C libs (mbed TLS et al.). Offline-safe degradation: a network error throws and is
				// surfaced as "scan unavailable", never a false-clean.
				nvdFetcher: makeNvdFetcher(),
				// EUVD: confirm each matched CVE against the EU Vulnerability Database (the CRA's named source) →
				// EUVD id + EPSS + KEV. Per-id failures degrade (never fail the scan). NVD/OSV stay the version-
				// precise matchers (EUVD carries no CPE); EUVD is the EU-authoritative confirmation layer.
				euvdFetcher: makeEuvdFetcher(),
				// Source attribution reflects what actually ran (was "OSV"-only, inaccurate — 2806g).
				source: "EUVD + NVD + OSV",
			},
		),
	mkdir: (dir) => mkdirSync(dir, { recursive: true }),
	writeFile: (filePath, content) => writeFileSync(filePath, content, "utf8"),
	now: () => new Date().toISOString().slice(0, 10),
}

/**
 * CVE scan trigger (CVE scan loop — design/15). The host-owned counterpart to the SBOM step: given a generated
 * SBOM (+ optionally the verified build dir), the HOST runs the scan loop in-process (normalize → OSV →
 * applicability → evidence) and returns the §3 markdown for the model to present + writes the §7
 * `compliance/cve-scan-<date>.{md,json}` artifacts faithfully. D11-R: the host produces the CVE evidence; the
 * model never fabricates a CVE — it triggers this and presents the result.
 *
 * STATUS: enabled — registered + advertised (system-prompt/tools/trigger_cve_scan.ts, gated by
 * CVE_SCAN_TOOL_ENABLED + the firmware-workspace predicate) + driven by the cve-scan k-bit. Output is honest by
 * construction (attributed + dated + hedged, verdictScan-clean). REMAINING (operator): a free-tier ground-truth
 * pass on the bit, and the design/16 spike to TUNE precision (linked-symbol soundness, swap real SPDX fixtures).
 *
 * Risk mitigations:
 *  - **Write-guard**: refuses to write artifacts inside the extension install or a bundled `demo-scenarios`
 *    sample (mirrors WriteToFileToolHandler's rule) — a scan run can't mutate read-only shipped assets.
 *  - **No SBOM / network failure**: surfaced as an explicit tool error (never a false "no vulnerabilities").
 */
export class TriggerCveScanHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.CVE_SCAN
	private readonly deps: CveScanHandlerDeps

	constructor(
		private context: vscode.ExtensionContext,
		deps: Partial<CveScanHandlerDeps> = {},
	) {
		this.deps = { ...defaultDeps, ...deps }
	}

	getDescription(block: ToolUse): string {
		const params = block.params as Record<string, string | undefined>
		return `[CVE scan: ${params.sbom || "SBOM"}]`
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const params = block.params as Record<string, string | undefined>
		const sbom = params.sbom
		if (!sbom) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "sbom")
		}
		config.taskState.consecutiveMistakeCount = 0

		const cwd = config.cwd || process.cwd()
		const sbomPath = path.isAbsolute(sbom) ? sbom : path.join(cwd, sbom)
		const buildDir = params.build ? (path.isAbsolute(params.build) ? params.build : path.join(cwd, params.build)) : undefined

		// Write the artifacts NEXT TO THE SBOM (its own compliance/ dir), never the cwd — a bare cwd like the
		// Desktop gets littered with a stray compliance/ folder and breaks checkpoints (observed on a real run).
		// The CRA workflow puts the SBOM under <project>/compliance/sbom/, so resolve back to that compliance/;
		// if the SBOM isn't under a compliance/ dir, fall back to beside the SBOM (still the project, not cwd).
		const marker = `${path.sep}compliance${path.sep}`
		const mIdx = sbomPath.lastIndexOf(marker)
		const outDir = mIdx !== -1 ? sbomPath.slice(0, mIdx + marker.length - 1) : path.join(path.dirname(sbomPath), "compliance")
		const guard = this.refuseIfProtected(outDir)
		if (guard) {
			await config.callbacks.say("error", guard)
			return formatResponse.toolError(guard)
		}

		await config.callbacks.say("tool", JSON.stringify({ tool: "triggerCveScan", path: sbom }))

		const asOf = this.deps.now()
		let result: ScanLoopResult
		try {
			result = await this.deps.scan({ sbomPath, buildDir, projectDir: cwd, asOf })
		} catch (err) {
			const msg = `CVE scan could not run: ${err instanceof Error ? err.message : String(err)}`
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		// Write the §7 artifacts host-side so the machine-readable JSON is exact (not re-typed by the model).
		try {
			this.deps.mkdir(outDir)
			this.deps.writeFile(path.join(outDir, `cve-scan-${asOf}.md`), result.report)
			this.deps.writeFile(path.join(outDir, `cve-scan-${asOf}.json`), result.json)
		} catch (err) {
			const msg = `CVE scan ran but the artifact could not be written: ${err instanceof Error ? err.message : String(err)}`
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		// Return the evidence-mode markdown for the model to present, plus a pointer to the written artifacts.
		return `${result.report}\n\n(Wrote ${path.join(outDir, `cve-scan-${asOf}.md`)} and ${path.join(outDir, `cve-scan-${asOf}.json`)}.)`
	}

	/** Mirror the write-guard: never write into the extension install or a bundled demo-scenarios sample. */
	private refuseIfProtected(targetDir: string): string | null {
		const norm = (p: string) => p.replace(/\\/g, "/")
		const target = norm(targetDir)
		const extRoot = norm(this.context.extensionUri.fsPath)
		if (target === extRoot || target.startsWith(`${extRoot}/`)) {
			return "Refusing to write a CVE scan inside the extension install — run it on your own project."
		}
		if (/\/demo-scenarios\//.test(target)) {
			return "Refusing to write a CVE scan inside a bundled sample (demo-scenarios) — it is read-only."
		}
		return null
	}
}
