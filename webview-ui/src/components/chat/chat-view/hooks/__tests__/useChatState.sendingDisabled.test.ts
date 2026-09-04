import type { ClineMessage } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useChatState } from "../useChatState"

/**
 * The composer must never be dead on the entry surface.
 *
 * [OPERATOR 2026-09-04] "there is like a no parking sign when I try to hit send." `sendingDisabled`
 * is written by exactly one component, ActionButtons, which renders only while a task exists. When
 * a task ended the writer unmounted still holding `true`, and nothing was left to clear it — so the
 * new-session composer was permanently disabled until the window was reloaded.
 *
 * The flag is now derived from whether a task exists at all, which is why the middle test matters:
 * it is the exact sequence that shipped broken.
 */

const msg = (text: string): ClineMessage => ({ ts: Date.now(), type: "say", say: "text", text }) as ClineMessage

describe("sending is never disabled when there is no task", () => {
	it("with no messages, sending is enabled from the start", () => {
		const { result } = renderHook(() => useChatState([]))
		expect(result.current.sendingDisabled).toBe(false)
	})

	it("a task that disabled sending leaves it enabled once the task is gone", () => {
		const { result, rerender } = renderHook(({ m }) => useChatState(m), { initialProps: { m: [msg("a task")] } })
		act(() => result.current.setSendingDisabled(true))
		expect(result.current.sendingDisabled).toBe(true)

		// Back to the entry surface. ActionButtons has unmounted holding `true`.
		rerender({ m: [] })
		expect(result.current.sendingDisabled).toBe(false)
	})

	it("while a task IS running the flag still governs, so approval gates keep working", () => {
		const { result } = renderHook(() => useChatState([msg("a task")]))
		act(() => result.current.setSendingDisabled(true))
		expect(result.current.sendingDisabled).toBe(true)
	})
})

/**
 * The second gate on the same composer. `nordicPhase` starts as "awaiting_mode" and only moves
 * once a task has more than one message — so on the entry surface it never moves, and the
 * input that starts every session was frozen by a rule about a mode chooser that is not there.
 * This is the raw state; InputSection scopes the freeze to `!!task && awaiting_mode`.
 */
describe("the mode-chooser freeze cannot apply where there is no task", () => {
	it("with no messages the raw phase is still awaiting_mode — the freeze must be scoped by the consumer", () => {
		const { result } = renderHook(() => useChatState([]))
		expect(result.current.nordicPhase).toBe("awaiting_mode")
		expect(result.current.task).toBeUndefined()
	})
})
