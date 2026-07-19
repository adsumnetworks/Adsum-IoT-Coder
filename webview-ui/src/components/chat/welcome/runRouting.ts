import type { HandoverStrip } from "@shared/handover"
import type { RunTarget } from "./useRunTarget"

/**
 * Where a click goes — as a pure decision, separate from the component that performs it.
 *
 * Every "nothing happens" the field has reported was a routing mistake hidden inside a component:
 * a typed line sent into a stopped session, or a sample falling through to `handleSendMessage` and
 * dying on our own external-agent factory guard. Inline branches like those cannot be tested, so
 * they shipped claimed-fixed and broken. The decision lives here; ChatView only obeys it.
 */

export type TypedRoute =
	| { kind: "message-agent" } // a live, reachable session — this is a message to it
	| { kind: "continue-here" } // live but stopped responding — bring it home, never queue into a void
	| { kind: "hand-over" } // agent mode, no session — this line is a new mission
	| { kind: "adsum" } // Adsum runs it

export type DemoRoute = { kind: "hand-over-demo" } | { kind: "adsum" }

/** A session we can still expect to act on what we send it. */
const reachable = (strip: HandoverStrip) => ["working", "idle", "never-picked-up"].includes(strip.liveness.state)

/** A returned session is history, not a destination. */
const liveSession = (strip: HandoverStrip | null | undefined): HandoverStrip | null => (strip && !strip.returned ? strip : null)

export function routeTypedTask(target: RunTarget, strip: HandoverStrip | null | undefined): TypedRoute {
	if (target !== "agent") {
		return { kind: "adsum" }
	}
	const live = liveSession(strip)
	if (!live) {
		return { kind: "hand-over" }
	}
	return reachable(live) ? { kind: "message-agent" } : { kind: "continue-here" }
}

/**
 * A sample is the zero-risk way to experience the whole loop, so in agent mode it hands over like any
 * other card. A sample needing a capability the agent cannot call yet stays in Adsum — and the card
 * says so before the click, because the toggle promised "no Adsum tokens".
 */
export function routeDemo(target: RunTarget, agentRunnable: boolean | undefined): DemoRoute {
	return target === "agent" && agentRunnable ? { kind: "hand-over-demo" } : { kind: "adsum" }
}
