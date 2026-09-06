import { AGENT_HANDOVER_ENABLED } from "@shared/handover"
import { useExtensionState } from "@/context/ExtensionStateContext"

export type RunTarget = "adsum" | "agent"

/**
 * Where cards and typed tasks execute — derived, never stored separately (mcp-sdk/13 D6).
 *
 * The single source of truth is the SELECTED PROVIDER: picking "Your own coding agent" in the API
 * Provider list is what turns agent mode on, exactly like picking any other provider decides where
 * inference runs. Conductor mode (no usable model at all) overlays agent mode WITHOUT touching the
 * stored config — a detector must never mutate what the developer chose.
 */
export function useRunTarget(): { target: RunTarget; conducting: boolean } {
	const { handoverUi, apiConfiguration, mode } = useExtensionState()
	// Feature off for this release (AGENT_HANDOVER_ENABLED). Every card, the composer, the demo picker
	// and the quota card derive their route from here, so one early return retires all of them at once —
	// and a workspace left on `apiProvider: external-agent` from the beta cannot strand the developer on
	// a provider that no longer routes anywhere.
	if (!AGENT_HANDOVER_ENABLED) {
		return { target: "adsum", conducting: false }
	}
	const conducting = !!handoverUi?.conductor.active
	const provider = mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider
	const target: RunTarget = conducting || provider === "external-agent" ? "agent" : "adsum"
	return { target, conducting }
}
