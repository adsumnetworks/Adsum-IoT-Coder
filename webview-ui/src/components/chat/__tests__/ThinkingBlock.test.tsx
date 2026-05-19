import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThinkingBlock } from "../ThinkingBlock"

// MarkdownRow renders content as plain text in tests
vi.mock("../MarkdownRow", () => ({
	MarkdownRow: ({ markdown }: { markdown: string }) => <div data-testid="markdown-content">{markdown}</div>,
}))

const noop = () => {}

describe("ThinkingBlock", () => {
	beforeEach(() => vi.clearAllMocks())

	// ── Visibility ──────────────────────────────────────────────────────────

	it("renders nothing when no content and not streaming", () => {
		const { container } = render(
			<ThinkingBlock content={undefined} durationMs={undefined} isExpanded={false} isStreaming={false} onToggle={noop} />,
		)
		expect(container.firstChild).toBeNull()
	})

	it("renders when streaming even with no content yet", () => {
		render(<ThinkingBlock content={undefined} durationMs={undefined} isExpanded={false} isStreaming={true} onToggle={noop} />)
		expect(screen.getByText("Thinking")).toBeDefined()
	})

	it("renders when content is present and not streaming", () => {
		render(<ThinkingBlock content="some thoughts" durationMs={5000} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText(/Thought for/)).toBeDefined()
	})

	// ── Label states ────────────────────────────────────────────────────────

	it('shows "Thinking" label while streaming', () => {
		render(
			<ThinkingBlock content="partial..." durationMs={undefined} isExpanded={false} isStreaming={true} onToggle={noop} />,
		)
		expect(screen.getByText("Thinking")).toBeDefined()
	})

	it('shows "Thought for Xs" when done with durationMs', () => {
		render(<ThinkingBlock content="done" durationMs={8000} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText("Thought for 8s")).toBeDefined()
	})

	it('shows "Thought" when done without durationMs', () => {
		render(<ThinkingBlock content="done" durationMs={undefined} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText("Thought")).toBeDefined()
	})

	// ── Duration formatting ─────────────────────────────────────────────────

	it("formats duration < 1s as '< 1s'", () => {
		render(<ThinkingBlock content="x" durationMs={500} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText("Thought for < 1s")).toBeDefined()
	})

	it("formats duration at exactly 1000ms as '1s'", () => {
		render(<ThinkingBlock content="x" durationMs={1000} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText("Thought for 1s")).toBeDefined()
	})

	it("rounds duration to nearest second", () => {
		render(<ThinkingBlock content="x" durationMs={1500} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText("Thought for 2s")).toBeDefined()
	})

	it("formats duration >= 60s in minutes and seconds", () => {
		render(<ThinkingBlock content="x" durationMs={75000} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText("Thought for 1m 15s")).toBeDefined()
	})

	it("formats exact minute without trailing '0s'", () => {
		render(<ThinkingBlock content="x" durationMs={120000} isExpanded={false} isStreaming={false} onToggle={noop} />)
		expect(screen.getByText("Thought for 2m")).toBeDefined()
	})

	// ── Expand / collapse ───────────────────────────────────────────────────

	it("visually hides content when collapsed (grid-rows-[0fr])", () => {
		const { container } = render(
			<ThinkingBlock content="secret thoughts" durationMs={1000} isExpanded={false} isStreaming={false} onToggle={noop} />,
		)
		// Content stays in DOM for smooth CSS animation; collapsed via grid-rows-[0fr]
		const grid = container.querySelector(".grid")
		expect(grid?.className).toContain("grid-rows-[0fr]")
	})

	it("renders content via MarkdownRow when expanded", () => {
		render(
			<ThinkingBlock content="visible thoughts" durationMs={1000} isExpanded={true} isStreaming={false} onToggle={noop} />,
		)
		expect(screen.getByTestId("markdown-content")).toBeDefined()
		expect(screen.getByText("visible thoughts")).toBeDefined()
	})

	// ── Toggle callback ─────────────────────────────────────────────────────

	it("calls onToggle when header button is clicked", () => {
		const onToggle = vi.fn()
		render(<ThinkingBlock content="thoughts" durationMs={2000} isExpanded={false} isStreaming={false} onToggle={onToggle} />)
		fireEvent.click(screen.getByRole("button"))
		expect(onToggle).toHaveBeenCalledOnce()
	})

	it("calls onToggle when clicked while streaming", () => {
		const onToggle = vi.fn()
		render(
			<ThinkingBlock
				content="streaming..."
				durationMs={undefined}
				isExpanded={true}
				isStreaming={true}
				onToggle={onToggle}
			/>,
		)
		fireEvent.click(screen.getByRole("button"))
		expect(onToggle).toHaveBeenCalledOnce()
	})

	// ── Chevron direction ───────────────────────────────────────────────────

	it("does not render chevrons while streaming", () => {
		render(
			<ThinkingBlock content="streaming..." durationMs={undefined} isExpanded={true} isStreaming={true} onToggle={noop} />,
		)
		// Chevron icons have aria role that varies; check by querying svg count or absence of known chevron
		// The safest check: no ChevronRight or ChevronDown since streaming shows dots only
		const svgs = document.querySelectorAll("svg")
		expect(svgs.length).toBe(0)
	})
})
