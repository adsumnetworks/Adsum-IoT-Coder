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

		// The HOST's verdict, written BEFORE the unchanged-environment early return below.
		// [BENCH 2026-09-04, I-31, corrected by Dev 2] Putting this after that return meant a
		// RESUMED task — where the environment is normally identical — recorded no verdict at all,
		// which is precisely the run you most want to explain after the fact. It also meant a
		// verdict never refreshed when the workspace changed under the agent's own hand (a seed
		// lands, the product becomes recognisable) while the environment did not.
		try {
			const found = recogniseProduct(getCachedWorkspaceRoots())
			metadata.host_verdict = {
				product: found?.id ?? null,
				product_evidence: found?.evidence ?? null,
				platform: getCachedWorkspaceSummary(),
				at: new Date().toISOString(),
			}
			await saveTaskMetadata(this.taskId, metadata)
		} catch (e) {
			// A diagnostic must never cost a task, or an environment entry.
			console.error("host verdict not recorded:", e)
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
