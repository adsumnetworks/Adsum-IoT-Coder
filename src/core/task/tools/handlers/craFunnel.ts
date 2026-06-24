/**
 * CRA funnel emit — the single host-side place that fires the milestone telemetry, shared by every
 * file-mutating / command handler so the funnel can't be bypassed by which tool the model happens to use.
 *
 * Keyed on the OUTPUT artifact (path or generating command) — the path/command is a LOCAL trigger only and
 * is NEVER put in the payload (payload = iot_platform ∈ {nrf,esp,both,none} + the global app_version
 * super-prop). Each milestone fires at most once per task (TaskState flags). See the pinned {surface,key}
 * table + design/08. Pure classifiers live in `craArtifact.ts` (unit-tested); this module is the thin,
 * telemetry-wired wrapper.
 */
import { getCachedWorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { telemetryService } from "@/services/telemetry"
import type { TaskConfig } from "../types/TaskConfig"
import { classifyCraArtifactPath, commandGeneratesCraSbom } from "./craArtifact"

function emitSbomOnce(config: TaskConfig): void {
	if (config.taskState.craSbomEmitted) {
		return
	}
	config.taskState.craSbomEmitted = true
	telemetryService.captureCraSbomGenerated({ iot_platform: getCachedWorkspaceSummary() })
}

function emitFixOnce(config: TaskConfig): void {
	if (config.taskState.craFixEmitted) {
		return
	}
	config.taskState.craFixEmitted = true
	telemetryService.captureCraFixCompleted({ iot_platform: getCachedWorkspaceSummary() })
}

/**
 * Fire the CRA milestone for a WRITTEN FILE (write_to_file / replace_in_file / apply_patch): an SBOM-lite
 * markdown under `compliance/sbom/` → cra_sbom_generated; a `compliance/cra-remediation-*.md` handoff →
 * cra_fix_completed. The golden-path SBOM (a tool, not a write) is handled by `emitCraMilestoneForCommand`.
 */
export function emitCraMilestoneForWrite(config: TaskConfig, absolutePath: string): void {
	const kind = classifyCraArtifactPath(absolutePath)
	if (kind === "sbom") {
		emitSbomOnce(config)
	} else if (kind === "fix") {
		emitFixOnce(config)
	}
}

/** Fire cra_sbom_generated when a successfully-run shell command generated the SBOM (the golden path). */
export function emitCraMilestoneForCommand(config: TaskConfig, command: string): void {
	if (commandGeneratesCraSbom(command)) {
		emitSbomOnce(config)
	}
}
