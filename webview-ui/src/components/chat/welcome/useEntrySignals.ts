import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { type EntryMode, type EntrySession, entryMode } from "./entryMode"
import type { Signals } from "./suggest"

/**
 * The entry surface's two questions — what shape is this, and what should it suggest — answered
 * once, from the host state, for every component that needs them.
 *
 * Two consumers already: the surface itself, and the composer's label in the chat footer. They
 * must never disagree about which folder the next session belongs to, so neither computes it.
 */

/** A product this workspace is recognisably about. Only what we can actually tell from the path —
 *  a guess dressed as detection would put a wrong reason on a card. */
function detectProduct(paths: string[]): string | undefined {
	const joined = paths.join(" ").toLowerCase()
	return joined.includes("lew840") || joined.includes("gateway") ? "lew840x" : undefined
}

export interface EntryContext {
	mode: EntryMode
	signals: Signals
	/** The folder the next session belongs to; "" when no folder is open. */
	scope: string
	/** Its display name. */
	scopeName: string
	roots: string[]
	/** No folder, no history: the cold start, where a sample is the only sensible first offer. */
	isColdStart: boolean
}

export function useEntrySignals(): EntryContext {
	const { taskHistory, openFolderPaths, workspaceClassification, workspaceFeatures, nrfEnvironment, espEnvironment } =
		useExtensionState()

	return useMemo(() => {
		const roots = openFolderPaths ?? []
		const scope = roots[0] ?? ""
		const history: EntrySession[] = (taskHistory ?? [])
			.filter((h) => h.ts && h.task)
			.map((h) => ({
				id: h.id,
				ts: h.ts,
				// The developer's name for it when they gave one — the resume card says what they call it.
				task: h.title?.trim() || h.task,
				cwd: h.cwdOnTaskInitialization,
				handoverId: h.handoverId,
			}))

		const mode = entryMode({ history, roots, scope, now: Date.now() })

		const signals: Signals = {
			nrfBoards: (nrfEnvironment?.boards ?? [])
				.map((b) => b.productName || b.deviceName || b.deviceFamily || "")
				.filter(Boolean),
			espDevices: (espEnvironment?.espDevices ?? []).map((d) => d.chip || "ESP32").filter(Boolean),
			classification: workspaceClassification ?? "none",
			toolchains: {
				nrf: !!(nrfEnvironment?.extensionPresent || nrfEnvironment?.nrfutilPresent),
				esp: !!(espEnvironment?.extensionPresent || espEnvironment?.idfPresent),
			},
			features: {
				hasBle: !!workspaceFeatures?.hasBle,
				hasWifi: !!workspaceFeatures?.hasWifi,
				hasCompliance: !!workspaceFeatures?.hasComplianceArtifacts,
			},
			hasWorkspace: roots.length > 0,
			product: detectProduct(roots),
		}

		return {
			mode,
			signals,
			scope,
			scopeName: scope ? (scope.split("/").pop() ?? scope) : "",
			roots,
			isColdStart: roots.length === 0 && history.length === 0,
		}
	}, [taskHistory, openFolderPaths, workspaceClassification, workspaceFeatures, nrfEnvironment, espEnvironment])
}
