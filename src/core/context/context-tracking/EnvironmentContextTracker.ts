import { collectEnvironmentMetadata, getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import { getCachedWorkspaceRoots, getCachedWorkspaceSummary, recogniseProduct } from "@/services/platform/WorkspaceClassifier"
import type { EnvironmentMetadataEntry } from "./ContextTrackerTypes"

export class EnvironmentContextTracker {
	readonly taskId: string

	constructor(taskId: string) {
		this.taskId = taskId
	}

	async recordEnvironment() {
		const metadata = await getTaskMetadata(this.taskId)

		if (!metadata.environment_history) {
			metadata.environment_history = []
		}

		const currentEnv = await collectEnvironmentMetadata()
		const currentEnvWithTs: EnvironmentMetadataEntry = {
			ts: Date.now(),
			...currentEnv,
		}

		const lastEntry = metadata.environment_history[metadata.environment_history.length - 1]
		if (lastEntry && this.isSameEnvironment(lastEntry, currentEnvWithTs)) {
			return // No change, don't add duplicate
		}

		metadata.environment_history.push(currentEnvWithTs)

		// Record what the HOST decided, not only what the environment was.
		// [BENCH 2026-09-04, I-31] Two routing issues had to be judged from the agent's reasoning,
		// because a transcript shows what the model did and never what it was told. "Was the
		// product row emitted?" was inferred from whether the agent happened to mention the
		// product — which is how a wrong conclusion comes to look settled. Written once per
		// environment change rather than per request: the verdict only moves when the workspace
		// does.
		try {
			const found = recogniseProduct(getCachedWorkspaceRoots())
			metadata.host_verdict = {
				product: found?.id ?? null,
				product_evidence: found?.evidence ?? null,
				platform: getCachedWorkspaceSummary(),
				at: new Date().toISOString(),
			}
		} catch (e) {
			// Diagnostics must never cost a task. A missing verdict reads as "unknown", which is
			// honest; a throw here would lose the environment entry as well.
			console.error("host verdict not recorded:", e)
		}

		await saveTaskMetadata(this.taskId, metadata)
	}

	private isSameEnvironment(a: EnvironmentMetadataEntry, b: EnvironmentMetadataEntry): boolean {
		return (
			a.os_name === b.os_name &&
			a.os_version === b.os_version &&
			a.os_arch === b.os_arch &&
			a.host_name === b.host_name &&
			a.host_version === b.host_version &&
			a.cline_version === b.cline_version
		)
	}
}
