import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
import { resolveAdvisoryHint } from "@/services/cra/advisoryHints"
import { defaultBuildEvidenceReaders } from "@/services/cra/buildEvidence"
import { runCveScanHost } from "@/services/cra/cveScanHost"
import { makeOsvFetcher } from "@/services/cra/osvFetcher"
import type { ScanLoopResult } from "@/services/cra/scanLoop"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/** Injectable seams (network/fs/clock) so execute() is unit-testable; production uses the real defaults. */
export interface CveScanHandlerDeps {
	scan: (args: { sbomPath: string; buildDir?: string; asOf: string }) => Promise<ScanLoopResult>
	mkdir: (dir: string) => void
	writeFile: (filePath: string, content: string) => void
	now: () => string
}

const defaultDeps: CveScanHandlerDeps = {
	scan: ({ sbomPath, buildDir, asOf }) =>
		runCveScanHost(
			{ sbomPath, buildDir },
			{ fetcher: makeOsvFetcher(), readers: defaultBuildEvidenceReaders(), resolveHint: resolveAdvisoryHint, asOf },
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
			result = await this.deps.scan({ sbomPath, buildDir, asOf })
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
