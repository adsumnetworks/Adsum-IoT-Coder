import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Run } from "@/components/rail/useRankedRuns"

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const rpc = vi.hoisted(() => ({ openSessionMock: vi.fn().mockResolvedValue("") }))
const runs = vi.hoisted(() => ({ current: { all: [] as unknown[], suggested: [] as unknown[] } }))

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/components/rail/openSession", () => ({ openSession: rpc.openSessionMock }))
vi.mock("@/components/rail/useRankedRuns", () => ({ useRankedRuns: () => runs.current }))
vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: {
		startSignIn: vi.fn().mockResolvedValue({ value: "" }),
		refreshAccount: vi.fn().mockResolvedValue({}),
		pasteSignInLink: vi.fn().mockResolvedValue({}),
		submitAccessRequest: vi.fn().mockResolvedValue({ value: "{}" }),
	},
	StateServiceClient: { captureEntryEvent: () => ({ catch: () => {} }) },
}))
vi.mock("./welcome/entryTelemetry", () => ({
	cardAction: () => {},
	gateShown: () => {},
	entryRunStart: () => {},
}))

import SessionPalette from "./SessionPalette"

const ranked = (item: Run) => ({ item, grounded: false, why: undefined })

const prefillRun: Run = {
	id: "debug",
	platform: "both",
	title: "Debug",
	blurb: "Find the fault",
	icon: "bug",
	kind: "prefill",
	group: "Runs",
	prompt: "Debug this board",
}

const fireRun: Run = {
	id: "sample:cra-sample",
	platform: "both",
	title: "Try a CRA sample",
	blurb: "about a minute",
	icon: "play",
	kind: "sample",
	group: "Samples",
	prompt: "Run the sample",
}

const lockedRun: Run = {
	id: "cellularGateway",
	platform: "product",
	title: "Build the cellular gateway",
	blurb: "needs an nRF91",
	icon: "radio-tower",
	kind: "locked",
	group: "Journeys",
	prompt: "Build it",
	entitlement: "cellular-src",
}

describe("SessionPalette", () => {
	beforeEach(() => {
		state.current = {}
		rpc.openSessionMock.mockClear()
		runs.current = { all: [], suggested: [] }
	})

	it("renders nothing closed", () => {
		const { container } = render(<SessionPalette hasTask={false} onClose={vi.fn()} onPrefill={vi.fn()} open={false} />)
		expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
	})

	it("a prefill row fills this tab's composer in an empty tab, rather than opening a new one", () => {
		runs.current = { all: [ranked(prefillRun)], suggested: [] }
		const onPrefill = vi.fn()
		const onClose = vi.fn()
		render(<SessionPalette hasTask={false} onClose={onClose} onPrefill={onPrefill} open={true} />)
		fireEvent.click(screen.getByTestId(`run-${prefillRun.id}`))
		expect(onPrefill).toHaveBeenCalledWith(prefillRun.prompt)
		expect(rpc.openSessionMock).not.toHaveBeenCalled()
		expect(onClose).toHaveBeenCalled()
	})

	it("a row picked when this tab already has a task opens a new tab instead of touching this one", () => {
		runs.current = { all: [ranked(prefillRun)], suggested: [] }
		const onPrefill = vi.fn()
		render(<SessionPalette hasTask={true} onClose={vi.fn()} onPrefill={onPrefill} open={true} />)
		fireEvent.click(screen.getByTestId(`run-${prefillRun.id}`))
		expect(onPrefill).not.toHaveBeenCalled()
		expect(rpc.openSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: prefillRun.prompt, send: false, title: prefillRun.title }),
		)
	})

	it("a fire/sample row always opens through openSession with send true, even in an empty tab", () => {
		runs.current = { all: [ranked(fireRun)], suggested: [] }
		const onPrefill = vi.fn()
		render(<SessionPalette hasTask={false} onClose={vi.fn()} onPrefill={onPrefill} open={true} />)
		fireEvent.click(screen.getByTestId(`run-${fireRun.id}`))
		expect(onPrefill).not.toHaveBeenCalled()
		expect(rpc.openSessionMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: fireRun.prompt, send: true }))
	})

	it("a locked row with no account opens the gate panel", () => {
		runs.current = { all: [ranked(lockedRun)], suggested: [] }
		render(<SessionPalette hasTask={false} onClose={vi.fn()} onPrefill={vi.fn()} open={true} />)
		fireEvent.click(screen.getByTestId(`run-${lockedRun.id}`))
		expect(screen.getByTestId("gate-panel")).toBeInTheDocument()
	})

	it("a locked, request-only row with an account opens the request-access form instead", () => {
		runs.current = { all: [ranked(lockedRun)], suggested: [] }
		state.current = { adsumAccount: { email: "dev@example.com", name: "Dev", emailVerified: true, groups: [] } }
		render(<SessionPalette hasTask={false} onClose={vi.fn()} onPrefill={vi.fn()} open={true} />)
		fireEvent.click(screen.getByTestId(`run-${lockedRun.id}`))
		expect(screen.getByTestId("request-family")).toHaveValue("lew840x")
	})
})
