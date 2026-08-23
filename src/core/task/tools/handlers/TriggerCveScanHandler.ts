import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
import type { ScanLoopResult } from "@/services/cra/scanLoop"
import { getCachedWorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { resolveToolAsync } from "@/services/tools/ToolResolver"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

const execFileAsync = promisify(execFile)

/** The tool bit that carries the scan engine and its curated advisory tables. */
const CVE_SCAN_TOOL = "adsum/cra/tools/cve-scan"

/**
 * Thrown when the engine could not be reached at all — as distinct from a scan that ran and found
 * nothing, and from bad input like a missing SBOM. The door reports those three differently on
 * purpose: only this one is a tooling problem, and only the last is the developer's next step.
 */
export class CveToolUnavailable extends Error {
	constructor(public readonly why: string) {
		super(`CVE scan not performed — tool unavailable (${why})`)
	}
}

/** `ScanLoopResult` crosses the process boundary as JSON; its Map has to be rebuilt by hand. */
function rehydrate(raw: Record<string, unknown>): ScanLoopResult {
	const entries = Array.isArray(raw.enrichment) ? (raw.enrichment as Array<[string, unknown]>) : []
	return { ...(raw as unknown as ScanLoopResult), enrichment: new Map(entries) as ScanLoopResult["enrichment"] }
}

/** Injectable seams (network/fs/clock) so execute() is unit-testable; production uses the real defaults. */
export interface CveScanHandlerDeps {
	scan: (args: {
		sbomPath: string
		buildDir?: string
		projectDir?: string
		asOf: string
	}) => Promise<ScanLoopResult>
	mkdir: (dir: string) => void
	writeFile: (filePath: string, content: string) => void
	now: () => string
}

const defaultDeps: CveScanHandlerDeps = {
	scan: async ({ sbomPath, buildDir, projectDir, asOf }) => {
		const resolved = await resolveToolAsync(CVE_SCAN_TOOL)
		if (!("tool" in resolved)) {
			throw new CveToolUnavailable(resolved.unavailable)
		}
		const args = [resolved.tool.entryPath, "--sbom", sbomPath, "--as-of", asOf]
		if (buildDir) {
			args.push("--build", buildDir)
		}
		if (projectDir) {
			args.push("--project", projectDir)
		}
		let stdout: string
		try {
			// argv array, never a shell string: the SBOM path comes from the model and real ones contain
			// spaces ("…/Application Support/…"). NVDAPIKEY travels in the environment — in argv it would
			// be visible in `ps` and in any echoed command line. 64 MB because a 180-component scan's JSON
			// is far past Node's 1 MB default, and truncated output parses as a smaller, cleaner scan.
			const { stdout: out } = await execFileAsync(process.execPath, args, {
				timeout: 180_000,
				maxBuffer: 64 * 1024 * 1024,
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			})
			stdout = out
		} catch (e) {
			const err = e as { stdout?: string; killed?: boolean; message?: string }
			if (err.killed) {
				throw new Error("CVE scan did not complete within 180 s — partial, not a clean result.")
			}
			// A non-zero exit still carries the envelope: the tool's contract is that it says why.
			if (!err.stdout) {
				throw new CveToolUnavailable(err.message ?? "the scan process produced no output")
			}
			stdout = err.stdout
		}

		let envelope: { status?: string; reason?: string; result?: Record<string, unknown> }
		try {
			envelope = JSON.parse(stdout)
		} catch {
			// Unreadable output is a hard error, never "unavailable" and never clean — this is what a
			// truncated stdout looks like, and it must not be mistaken for a smaller scan.
			throw new Error("CVE scan produced unreadable output.")
		}
		if (envelope.status !== "ok" || !envelope.result) {
			// Bad input keeps the engine's own sentence — for a missing SBOM that sentence tells the
			// developer to generate one, which is a different conversation from a broken tool.
			throw new Error(envelope.reason ?? "CVE scan failed.")
		}
		return rehydrate(envelope.result)
	},
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
		// path.normalize converts any forward slashes to the platform separator — needed because an
		// already-absolute path (e.g. a POSIX-style path from cross-platform tooling or model output)
		// bypasses path.join and would otherwise reach the sbomDirMarker/compliance-marker lookups
		// below still using "/", which never matches the path.sep-based markers on Windows and silently
		// misfiles the CVE artifacts into a bogus nested "sbom/compliance/" folder.
		const sbomPath = path.normalize(path.isAbsolute(sbom) ? sbom : path.join(cwd, sbom))
		const buildDir = params.build
			? path.normalize(path.isAbsolute(params.build) ? params.build : path.join(cwd, params.build))
			: undefined

		// Write the CVE artifacts into the SBOM's OWN compliance folder, beside its `sbom/` dir — never the cwd (a
		// bare cwd like the Desktop gets littered + breaks checkpoints). The workflow puts the SBOM under
		// `<compliance-dir>/sbom/`, where <compliance-dir> is `compliance/` OR a dated `compliance/cra-<date>/`
		// (design/29). So resolve to the PARENT of the `sbom/` dir → the cve-scan lands next to the report + SBOM in
		// the SAME (possibly dated) folder, which is exactly where the integrity guard looks for siblings.
		const sbomDirMarker = `${path.sep}sbom${path.sep}`
		const sIdx = sbomPath.lastIndexOf(sbomDirMarker)
		let outDir: string
		if (sIdx !== -1) {
			outDir = sbomPath.slice(0, sIdx) // parent of `sbom/` → the (possibly dated) compliance folder
		} else {
			// SBOM not under a `sbom/` dir — fall back to its enclosing `compliance/`, else a sibling compliance/.
			const marker = `${path.sep}compliance${path.sep}`
			const mIdx = sbomPath.lastIndexOf(marker)
			outDir = mIdx !== -1 ? sbomPath.slice(0, mIdx + marker.length - 1) : path.join(path.dirname(sbomPath), "compliance")
		}
		const guard = this.refuseIfProtected(outDir)
		if (guard) {
			await config.callbacks.say("error", guard)
			return formatResponse.toolError(guard)
		}

		await config.callbacks.say("tool", JSON.stringify({ tool: "triggerCveScan", path: sbom }))

		// Liveness row (H1): the scan blocks this turn for 30–90+ s (three DBs + NVD rate windows) and the model
		// can emit nothing while it runs — without a visible in-progress indicator users read the silence as a
		// stall (two operator reports). Emit ONE COMPLETE say BEFORE the scan; the webview renders it as the
		// spinner card with a live (client-side) elapsed timer for as long as it is the last message — i.e. the
		// entire blocking scan — then a compact line once the run moves on.
		// RELIABILITY (regression fix): this is deliberately a SINGLE non-partial say. An earlier variant streamed
		// per-source phases via fire-and-forget `partial` says; a partial row can finalize or lose the race before
		// the webview paints it, so the wheel sometimes never appeared. The client-side timer conveys liveness on
		// its own; the engine's onProgress seam stays wired (tested) but is not needed to keep the row visible.
		const scanSources = ["EU Vulnerability Database (ENISA)", "NVD by CPE", "OSV by PURL"]
		await config.callbacks.say(
			"cve_scan_progress",
			JSON.stringify({
				sources: scanSources,
				estimate: "30–90 s",
				phase: "CVE scan in progress — NVD by CPE is the rate-limited lane (usually the slow part)",
			}),
		)

		const asOf = this.deps.now()
		let result: ScanLoopResult
		try {
			result = await this.deps.scan({ sbomPath, buildDir, projectDir: cwd, asOf })
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			// Leave a machine-readable tombstone beside where the report would go. Without it the integrity
			// guard finds no scan artifact at all, reads that as "nothing to check", and a report claiming
			// "no known CVEs" sails through — the exact hole this door exists to close.
			if (err instanceof CveToolUnavailable) {
				try {
					this.deps.mkdir(outDir)
					this.deps.writeFile(
						path.join(outDir, `cve-scan-${asOf}.json`),
						`${JSON.stringify({ schema: "adsum.cve-scan/1", status: "not-performed", reason: err.why, asOf, coverage: null, findings: null }, null, 2)}\n`,
					)
				} catch {
					// best-effort; the refusal below is the guarantee
				}
			}
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(
				err instanceof CveToolUnavailable
					? `${msg}\n\nDo NOT report a CVE count or a clean result for this build — no scan ran.`
					: `CVE scan could not run: ${msg}`,
			)
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

		// CVE scan succeeded — record aggregate feature health (counts only; never CVE ids or component names).
		telemetryService.captureCveScanCompleted({
			iot_platform: getCachedWorkspaceSummary(),
			findings: result.findings.length,
			queried: result.queriedCount,
			coverageTotal: result.coverage.total,
			coverageQueryable: result.coverage.queryable,
		})

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
