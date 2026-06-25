import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
import { resolveAdvisoryHint } from "@/services/cra/advisoryHints"
import { defaultBuildEvidenceReaders } from "@/services/cra/buildEvidence"
import { runCveScanHost } from "@/services/cra/cveScanHost"
import { makeOsvFetcher } from "@/services/cra/osvFetcher"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * CVE scan trigger (CVE scan loop — design/15). The host-owned counterpart to the SBOM step: given a generated
 * SBOM (+ optionally the verified build dir), the HOST runs the scan loop in-process (normalize → OSV →
 * applicability → evidence) and returns the §3 markdown for the model to present + writes the §7
 * `compliance/cve-scan-<date>.{md,json}` artifacts faithfully. D11-R: the host produces the CVE evidence; the
 * model never fabricates a CVE — it triggers this and presents the result.
 *
 * STATUS: built + unit-tested at the service layer (src/services/cra), but NOT advertised to the model yet —
 * it is intentionally left out of the prompt tool-set (system-prompt/tools/init.ts) and gated by
 * CVE_SCAN_TOOL_ENABLED in trigger_cve_scan.ts, pending the design/16 spike + a free-tier ground-truth pass.
 * This handler is registered (routable) so enabling is a one-step prompt change once validated.
 *
 * Risk mitigations:
 *  - **Write-guard**: refuses to write artifacts inside the extension install or a bundled `demo-scenarios`
 *    sample (mirrors WriteToFileToolHandler's rule) — a scan run can't mutate read-only shipped assets.
 *  - **No SBOM / network failure**: surfaced as an explicit tool error (never a false "no vulnerabilities").
 */
export class TriggerCveScanHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.CVE_SCAN

	constructor(private context: vscode.ExtensionContext) {}

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

		const outDir = path.join(cwd, "compliance")
		const guard = this.refuseIfProtected(outDir)
		if (guard) {
			await config.callbacks.say("error", guard)
			return formatResponse.toolError(guard)
		}

		await config.callbacks.say("tool", JSON.stringify({ tool: "triggerCveScan", path: sbom }))

		const asOf = new Date().toISOString().slice(0, 10)
		let result: Awaited<ReturnType<typeof runCveScanHost>>
		try {
			result = await runCveScanHost(
				{ sbomPath, buildDir },
				{
					fetcher: makeOsvFetcher(),
					readers: defaultBuildEvidenceReaders(),
					resolveHint: resolveAdvisoryHint,
					asOf,
				},
			)
		} catch (err) {
			const msg = `CVE scan could not run: ${err instanceof Error ? err.message : String(err)}`
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		// Write the §7 artifacts host-side so the machine-readable JSON is exact (not re-typed by the model).
		try {
			mkdirSync(outDir, { recursive: true })
			writeFileSync(path.join(outDir, `cve-scan-${asOf}.md`), result.report, "utf8")
			writeFileSync(path.join(outDir, `cve-scan-${asOf}.json`), result.json, "utf8")
		} catch (err) {
			const msg = `CVE scan ran but the artifact could not be written: ${err instanceof Error ? err.message : String(err)}`
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		// Return the evidence-mode markdown for the model to present, plus a pointer to the written artifacts.
		return `${result.report}\n\n(Wrote compliance/cve-scan-${asOf}.md and compliance/cve-scan-${asOf}.json.)`
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
