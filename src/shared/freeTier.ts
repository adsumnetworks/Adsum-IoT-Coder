/**
 * [0.5 free tier quota states] The free-tier quota shape the host posts on ExtensionState and the
 * webview will render. Lives in shared, not in the host-only quota logic (src/services/adsum/
 * quotaState.ts), so the webview can import the type without pulling in host code.
 */

export type FreeTierQuotaKind = "ok" | "low" | "spent" | "limited"

export interface FreeTierQuotaState {
	kind: FreeTierQuotaKind
	/** Tokens left, when known. Absent when the free tier isn't active or nothing has been reported yet. */
	remaining?: number
	/** ISO timestamp a `limited` state is expected to clear, when the backend gave a retry-after. */
	resetsAt?: string
}
