import { blg20Label, confirmedBlg20Units } from "@shared/blg20"
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
/**
 * A product the open folder is recognisably about, from its PATH alone (the host's tree-based
 * recognition feeds the agent's prompt; this is the entry surface's cheap read). [10 Oct 2026] The
 * bare word "gateway" used to count as the LEW840x: a folder called blg20x-new-gateway, empty but for
 * a BLG20x on USB, led with "this looks like a Fanstel LEW840x project". A product is named by its
 * own name or not at all.
 */
function detectProduct(paths: string[]): string | undefined {
	const joined = paths.join(" ").toLowerCase()
	if (joined.includes("lew840")) {
		return "lew840x"
	}
	if (/blg20|lbg20/.test(joined)) {
		return "blg20"
	}
	return undefined
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
			// A connected BLG20x first, by name: the gateway cards (ladder, cellular, request access) key on "blg20".
			// Only a unit something has NAMED a BLG20: a probe pair or a bare test id is "possibly a BLG20",
			// shown on the strip and never claimed by a card (demo-1 plan, red-team finding 7).
			nrfBoards: [
				...confirmedBlg20Units(nrfEnvironment?.blg20Units).map(blg20Label),
				...(nrfEnvironment?.boards ?? []).map((b) => b.productName || b.deviceName || b.deviceFamily || ""),
			].filter(Boolean),
			espDevices: (espEnvironment?.espDevices ?? []).map((d) => d.chip || "ESP32").filter(Boolean),
			// What each probe says its TARGET is, which is not what the board list shows: a BLG20x
			// debugged through a kit lists the kit, while the probe reports nRF54LM20B and nRF9151.
			nrfChips: (nrfEnvironment?.boards ?? []).map((b) => b.deviceName || b.deviceFamily || "").filter(Boolean),
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
