import type { ICheckpointManager } from "@integrations/checkpoints/types"
import pTimeout from "p-timeout"

/**
 * Ensures a checkpoint manager is initialized, handling both single-root and multi-root implementations.
 * - TaskCheckpointManager exposes `checkpointTrackerCheckAndInit()`
 * - MultiRootCheckpointManager exposes `initialize()`
 */
export async function ensureCheckpointInitialized({
	checkpointManager,
	timeoutMs = 15_000,
	timeoutMessage = "Checkpoints could not finish initializing for this project, so they are off for this task. " +
		"Everything else works normally. This is usually a very large working tree (build/ output is the common cause).",
}: {
	checkpointManager: ICheckpointManager | undefined
	timeoutMs?: number
	timeoutMessage?: string
}): Promise<void> {
	if (!checkpointManager) {
		return
	}
	// TaskCheckpointManager path
	const maybeInit = checkpointManager.checkpointTrackerCheckAndInit
	if (typeof maybeInit === "function") {
		await pTimeout(maybeInit.call(checkpointManager), {
			milliseconds: timeoutMs,
			message: timeoutMessage,
		})
		return
	}

	// MultiRootCheckpointManager path
	const maybeInitialize = checkpointManager.initialize
	if (typeof maybeInitialize === "function") {
		await pTimeout(maybeInitialize.call(checkpointManager), {
			milliseconds: timeoutMs,
			message: timeoutMessage,
		})
	}
}
