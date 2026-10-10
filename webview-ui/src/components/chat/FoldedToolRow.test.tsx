import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { foldRows } from "@/utils/foldRows"
import FoldedToolRow from "./FoldedToolRow"

const renderMessage = (m: ClineMessage) => <div data-testid={`raw-${m.ts}`}>{m.text}</div>

const commands: ClineMessage[] = [
	{ ts: 1, type: "say", say: "command", text: "echo one", commandCompleted: true },
	{ ts: 2, type: "say", say: "command", text: "echo two", commandCompleted: true },
]

describe("FoldedToolRow", () => {
	it("collapses a fold group to one worklog line by default", () => {
		const [row] = foldRows(commands)
		render(<FoldedToolRow renderMessage={renderMessage} row={row} />)
		expect(screen.getByTestId("folded-tool-row-toggle")).toHaveTextContent("ran 2 commands")
		expect(screen.queryByTestId("folded-tool-row-detail")).not.toBeInTheDocument()
	})

	it("expands to the raw rows on click, and collapsing never drops them", () => {
		const [row] = foldRows(commands)
		render(<FoldedToolRow renderMessage={renderMessage} row={row} />)
		fireEvent.click(screen.getByTestId("folded-tool-row-toggle"))
		expect(screen.getByTestId("raw-1")).toHaveTextContent("echo one")
		expect(screen.getByTestId("raw-2")).toHaveTextContent("echo two")

		fireEvent.click(screen.getByTestId("folded-tool-row-toggle"))
		expect(screen.queryByTestId("folded-tool-row-detail")).not.toBeInTheDocument()
		// Collapsing is a view toggle, not a delete — expanding again brings the same rows back.
		fireEvent.click(screen.getByTestId("folded-tool-row-toggle"))
		expect(screen.getByTestId("raw-1")).toBeInTheDocument()
		expect(screen.getByTestId("raw-2")).toBeInTheDocument()
	})

	it("renders a standalone row (an ask or an error) exactly as given, with no fold chrome", () => {
		const errorMessage: ClineMessage = { ts: 3, type: "say", say: "error", text: "disk full" }
		const [row] = foldRows([errorMessage])
		render(<FoldedToolRow renderMessage={renderMessage} row={row} />)
		expect(screen.queryByTestId("folded-tool-row")).not.toBeInTheDocument()
		expect(screen.getByTestId("raw-3")).toHaveTextContent("disk full")
	})
})
