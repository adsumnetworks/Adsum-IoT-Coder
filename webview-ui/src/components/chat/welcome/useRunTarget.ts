import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"

export type RunTarget = "adsum" | "agent"
const TARGET_KEY = "adsum.runTarget"

/**
 * The session-level run-target (mockup mcp-sdk/11): where do cards execute — this panel, or the
 * developer's own coding agent? Persisted per install; conductor mode (no usable model) locks it to
 * the agent. Shared by every surface that starts work, so the toggle's promise holds everywhere —
 * a surface that ignored it would silently spend Adsum inference the developer just opted out of.
 */
export function useRunTarget(): { target: RunTarget; conducting: boolean; setTarget: (t: RunTarget) => void } {
	const { handoverUi } = useExtensionState()
	const conducting = !!handoverUi?.conductor.active
	const [target, setTargetState] = useState<RunTarget>(() => {
		if (conducting) {
			return "agent"
		}
		try {
			return localStorage.getItem(TARGET_KEY) === "agent" ? "agent" : "adsum"
		} catch {
			return "adsum"
		}
	})
	useEffect(() => {
		if (conducting && target !== "agent") {
			setTargetState("agent")
		}
	}, [conducting, target])
	const setTarget = (t: RunTarget) => {
		setTargetState(t)
		try {
			localStorage.setItem(TARGET_KEY, t)
		} catch {}
	}
	return { target, conducting, setTarget }
}
