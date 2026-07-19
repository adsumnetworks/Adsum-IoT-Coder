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
	const conducting = !!handoverUi?.conductor.active
	const provider = mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider
	const target: RunTarget = conducting || provider === "external-agent" ? "agent" : "adsum"
	return { target, conducting }
}
