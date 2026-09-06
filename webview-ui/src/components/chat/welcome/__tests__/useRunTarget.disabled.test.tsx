import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { routeDemo, routeTypedTask } from "../runRouting"
import { useRunTarget } from "../useRunTarget"

/**
 * S0 (webview half) — with agent handover off, every surface that asks "where does this run?" must
 * answer "Adsum", including for a workspace left on the external-agent provider by the beta.
 *
 * `useRunTarget` is the only derivation the cards, the composer, the demo picker and the quota card
 * read, so proving it here proves all of them; the routing helpers are checked alongside because they
 * are what consume its answer.
 */
const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))

describe("useRunTarget with AGENT_HANDOVER_ENABLED = false", () => {
	it("routes to Adsum even when the host claims conductor mode", () => {
		// A stale `handoverUi` cannot arrive (the controller sends undefined) — but if it ever did,
		// the hook must not act on it.
		state.current = {
			handoverUi: { conductor: { active: true, reason: "no inference provider configured" }, strip: null },
			apiConfiguration: {},
			mode: "act",
		}
		expect(useRunTargetValue()).toEqual({ target: "adsum", conducting: false })
	})

	it("routes to Adsum for a workspace still set to the external-agent provider", () => {
		state.current = {
			handoverUi: undefined,
			apiConfiguration: { actModeApiProvider: "external-agent", planModeApiProvider: "external-agent" },
			mode: "act",
		}
		expect(useRunTargetValue()).toEqual({ target: "adsum", conducting: false })
		state.current = { ...state.current, mode: "plan" }
		expect(useRunTargetValue()).toEqual({ target: "adsum", conducting: false })
	})

	it("so a typed task starts in Adsum and a demo runs here, never a hand-over", () => {
		const { target } = useRunTargetValue()
		expect(routeTypedTask(target, null)).toEqual({ kind: "adsum" })
		expect(routeDemo(target, true)).toEqual({ kind: "adsum" })
	})
})

function useRunTargetValue() {
	return renderHook(() => useRunTarget()).result.current
}
