import { getCachedEspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import { getCachedNrfEnvironment } from "@/services/nrf/EnvironmentDetector"
import { getCachedWorkspaceClassification } from "@/services/platform/WorkspaceClassifier"
import { envFromDetectors } from "./hostFacts"
import { buildWorkspaceMap } from "./mapBuilder"
import { MAP_CAP_CHARS, renderMap } from "./mapDrop"
import { memoryAnchors } from "./projectAnchor"
import { ensureAdsumScaffold, readEnv, writeEnv, writeMapMd } from "./store"

/**
 * Write down what the host already detected.
 *
 * Every fact here was ALREADY being computed and cached by the extension — and then thrown away
 * after building one prompt. That is why sessions kept re-running SDK version probes and directory
 * listings: nothing ever recorded the answer. This module is the "write it down" half.
 *
 * Everything is best-effort. Memory is an enhancement, so a failure here must be invisible to the
 * user and must never interrupt activation or a save.
 */

/** Refresh the toolchain record (NCS / ESP-IDF versions). Cheap: reads already-populated caches. */
export function refreshToolchainMemory(cwd: string | undefined, nowIso: string): void {
	try {
		if (!cwd) {
			return
		}
		ensureAdsumScaffold(cwd)
		const next = envFromDetectors(getCachedNrfEnvironment() as never, getCachedEspEnvironment() as never, nowIso)
		const prev = readEnv(cwd)
		// Only write when something actually changed. An unconditional write would touch the file's
		// mtime every activation, and PROJECT.md's mtime feeds the prompt fingerprint — a pointless
		// write would cost a full prompt rebuild for no new information.
		if (JSON.stringify({ ...prev, detectedAt: undefined }) === JSON.stringify({ ...next, detectedAt: undefined })) {
			return
		}
		writeEnv(cwd, next)
	} catch {
		// never surface
	}
}

/** Application folders the classifier found under this workspace. */
function detectedAppRoots(): string[] {
	const classification = getCachedWorkspaceClassification?.()
	return Array.isArray((classification as { apps?: Array<{ path: string }> })?.apps)
		? ((classification as { apps: Array<{ path: string }> }).apps.map((a) => a.path) ?? [])
		: []
}

/**
 * Rebuild the workspace file map. Called on activation and after config saves.
 *
 * The map is written to EVERY anchor that should carry memory, not just the workspace root: a
 * multi-app repo gets a shared map alongside one per app, so each app's memory describes that app.
 * Anchors that cannot hold memory (no project there, or a personal folder) are skipped entirely.
 */
export async function refreshWorkspaceMapMemory(cwd: string | undefined): Promise<void> {
	try {
		if (!cwd) {
			return
		}
		const appRoots = detectedAppRoots()
		const anchors = memoryAnchors(cwd, appRoots)
		if (!anchors.length) {
			return
		}
		for (const anchor of anchors) {
			if (!ensureAdsumScaffold(anchor)) {
				continue
			}
			// Map each anchor's OWN subtree — an app's map should describe that app, not its siblings.
			const map = await buildWorkspaceMap(anchor)
			const rendered = renderMap(map, MAP_CAP_CHARS, appRoots, map.truncation)
			writeMapMd(anchor, rendered)
		}
	} catch {
		// never surface
	}
}

/** Everything the host can record without touching hardware. Safe to call on activation. */
export async function refreshHostMemory(cwd: string | undefined, nowIso: string): Promise<void> {
	for (const anchor of memoryAnchors(cwd, detectedAppRoots())) {
		refreshToolchainMemory(anchor, nowIso)
	}
	await refreshWorkspaceMapMemory(cwd)
}
