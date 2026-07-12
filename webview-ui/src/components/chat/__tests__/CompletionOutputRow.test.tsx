import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CompletionOutputRow } from "../CompletionOutputRow"

// Keep the render light: markdown + gRPC-backed children are irrelevant to the handoff contract under test.
vi.mock("../MarkdownRow", () => ({
	MarkdownRow: ({ markdown }: { markdown: string }) => <div data-testid="markdown">{markdown}</div>,
}))
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: { taskCompletionViewChanges: vi.fn() },
}))

const baseProps = {
	quoteButtonState: { visible: false, left: 0, top: 0, selectedText: "" },
	handleQuoteClick: () => {},
	showActionRow: false,
	seeNewChangesDisabled: false,
	setSeeNewChangesDisabled: () => {},
	explainChangesDisabled: false,
	setExplainChangesDisabled: () => {},
	messageTs: 1,
}

/**
 * No-ending sessions (operator direction, 1307): every completion renders as a HANDOFF — the green
 * "Task Completed" banner must never appear, marker or no marker. The <!--NEXT_STEPS--> marker only
 * selects the title and is stripped from the body.
 */
describe("CompletionOutputRow — handoff, never an ending", () => {
	it("never renders 'Task Completed', even without the NEXT_STEPS marker", () => {
		render(<CompletionOutputRow {...baseProps} text="The fix is applied and verified." />)
		expect(screen.queryByText("Task Completed")).toBeNull()
		expect(screen.getByText("Summary")).toBeDefined()
	})

	it("renders the next-steps title when the marker is present, and strips the marker from the body", () => {
		render(<CompletionOutputRow {...baseProps} text={"<!--NEXT_STEPS-->\nTriage the next CVE whenever you're ready."} />)
		expect(screen.queryByText("Task Completed")).toBeNull()
		expect(screen.getByText("Suggested next steps")).toBeDefined()
		expect(screen.getByTestId("markdown").textContent).not.toContain("<!--NEXT_STEPS-->")
	})
})
