import type { HandoverStrip, HandoverUiState } from "@shared/handover"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AgentStrip from "../AgentStrip"

const mockState: { handoverUi?: HandoverUiState } = {}
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => mockState }))
vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		continueHandoverHere: vi.fn(() => Promise.resolve({})),
		showHandoverWorklog: vi.fn(() => Promise.resolve({})),
	},
}))
vi.mock("@shared/proto/cline/common", () => ({ EmptyRequest: { create: () => ({}) } }))

const strip = (over: Partial<HandoverStrip> = {}): HandoverUiState => ({
	conductor: { active: true, reason: "no inference provider configured" },
	strip: {
		id: "ui01",
		phase: "posted",
		mission: "Test and validate softAP",
		calls: 0,
		startedAt: new Date().toISOString(),
		pickupPrompt: "Check the Adsum inbox and pick up the session (ui01).",
		baseline: { created: true, snapshots: 1 },
		packed: { bits: 14, governing: { title: "Test & Validate Workflow", author: "Omar Morceli", version: "1.2.0" } },
		milestones: [],
		truncated: false,
		...over,
	},
})

describe("AgentStrip", () => {
	beforeEach(() => {
		mockState.handoverUi = undefined
	})

	it("renders nothing when no session is with the agent", () => {
		const { container } = render(<AgentStrip />)
		expect(container).toBeEmptyDOMElement()
	})

	it("posted: shows how to pick it up, what was packed, and who curated it", () => {
		mockState.handoverUi = strip()
		render(<AgentStrip />)
		expect(screen.getByText(/Check the Adsum inbox/)).toBeInTheDocument()
		expect(screen.getByText(/check the Adsum inbox\./)).toBeInTheDocument() // the say-it-out-loud fallback
		expect(screen.getByText(/14 knowledge bits packed/)).toBeInTheDocument()
		expect(screen.getByText("Omar Morceli")).toBeInTheDocument()
		expect(screen.getByText(/safety snapshot created/)).toBeInTheDocument()
	})

	it("working: renders both witnesses, and only host-observed rows carry the 'seen by Adsum' tag", () => {
		mockState.handoverUi = strip({
			phase: "working",
			calls: 6,
			milestones: [
				{ kind: "step", t: "2026-07-19T10:00:00Z", step: "Step 2: Survey", text: "Survey done" },
				{ kind: "tool", t: "2026-07-19T10:01:00Z", command: "idf.py build", exit: 0 },
				{ kind: "host", t: "2026-07-19T10:02:00Z", files: ["main/sta_table.h"] },
				{ kind: "nudge", t: "2026-07-19T10:03:00Z", text: "nudged: edited source without building" },
			],
			live: { verb: "building…", sinceSec: 12 },
		})
		render(<AgentStrip />)
		expect(screen.getByText("Survey done")).toBeInTheDocument()
		expect(screen.getByText("Step 2: Survey")).toBeInTheDocument()
		expect(screen.getByText("idf.py build")).toBeInTheDocument()
		expect(screen.getByText(/1 file changed/)).toBeInTheDocument()
		expect(screen.getByText(/edited source without building/)).toBeInTheDocument()
		expect(screen.getByText("building…")).toBeInTheDocument()
		// the honesty rule: exactly the two host-observed rows are tagged, not the agent's claim
		expect(screen.getAllByText("seen by Adsum")).toHaveLength(2)
	})

	it("closed: the receipt separates what the agent SAYS from what Adsum MEASURED", () => {
		mockState.handoverUi = strip({
			phase: "closed",
			calls: 23,
			closedAt: new Date().toISOString(),
			closing: {
				headline: "Suite scaffolded and green",
				itSays: { files: ["test/main/test_sta.c"], nextStep: "Run on hardware when a board is connected" },
				adsumSaw: { diffstat: "3 files changed, 214 insertions(+), 9 deletions(-)", snapshots: 4, buildsGreen: true },
				standingOn: { authors: ["Omar Morceli"], steward: "Adsum Networks", bits: 2 },
			},
		})
		render(<AgentStrip />)
		expect(screen.getByText("It says")).toBeInTheDocument()
		expect(screen.getByText("Adsum saw")).toBeInTheDocument()
		expect(screen.getByText(/Touched test\/main\/test_sta\.c/)).toBeInTheDocument()
		expect(screen.getByText(/3 files changed/)).toBeInTheDocument()
		expect(screen.getByText(/Run on hardware/)).toBeInTheDocument()
		expect(screen.getByText("Continue here")).toBeInTheDocument()
	})

	it("says so honestly when nothing was measured, rather than implying a clean result", () => {
		mockState.handoverUi = strip({
			phase: "closed",
			closing: {
				headline: "Done",
				itSays: { files: ["a.c"] },
				adsumSaw: { snapshots: 0, buildsGreen: false },
				standingOn: { authors: [], bits: 0 },
			},
		})
		render(<AgentStrip />)
		expect(screen.getByText(/no working-tree change measured/)).toBeInTheDocument()
	})

	it("never leaks internal vocabulary to the developer", () => {
		mockState.handoverUi = strip({ phase: "working", milestones: [] })
		const { container } = render(<AgentStrip />)
		const text = container.textContent ?? ""
		for (const word of ["MCP", "ledger", "brief.json", "handover"]) {
			expect(text.toLowerCase()).not.toContain(word.toLowerCase())
		}
		expect(text).toContain("Your coding agent")
	})
})
