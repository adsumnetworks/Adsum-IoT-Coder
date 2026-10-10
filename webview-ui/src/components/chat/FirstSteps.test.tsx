import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FirstSteps, { firstStepsEligible } from "./FirstSteps"

const noop = () => {}
const handlers = { onOpenProject: noop, onPrefillBuild: noop, onPrefillGateway: noop, onRegister: noop, onRunSample: noop }

// This jsdom setup carries no real localStorage (confirmed: `typeof window.localStorage` is
// "undefined" here) — exactly the absence the component's own try/catch is written for. A fake
// store, same shape as EntryDrawerKeyboard.test.tsx's, lets the dismiss contract be tested for real.
const _store = new Map<string, string>()
vi.stubGlobal("localStorage", {
	clear: () => _store.clear(),
	getItem: (k: string) => _store.get(k) ?? null,
	removeItem: (k: string) => _store.delete(k),
	setItem: (k: string, v: string) => {
		_store.set(k, v)
	},
})

beforeEach(() => {
	localStorage.clear()
})

describe("firstStepsEligible", () => {
	it("is eligible until dismissed", () => {
		expect(firstStepsEligible()).toBe(true)
		localStorage.setItem("adsum.firstSteps.dismissed", "1")
		expect(firstStepsEligible()).toBe(false)
	})
})

describe("FirstSteps", () => {
	it("renders all five rows, undone, with the first offered via 'Show me'", () => {
		render(<FirstSteps state={{}} {...handlers} />)
		expect(screen.getByTestId("first-steps")).toBeInTheDocument()
		expect(screen.getByText("Run the sample debug session")).toBeInTheDocument()
		expect(screen.getByText("Open your project")).toBeInTheDocument()
		expect(screen.getByText("Build, flash and debug a board")).toBeInTheDocument()
		expect(screen.getByText("Register for free")).toBeInTheDocument()
		expect(screen.getByText("Set up a gateway")).toBeInTheDocument()
		// Only the next undone row carries the pill.
		expect(screen.getAllByText("Show me")).toHaveLength(1)
		expect(screen.getByTestId("first-steps-row-sample")).toContainElement(screen.getByText("Show me"))
	})

	it("strikes through a done row and dims it, moving the pill to the next undone one", () => {
		render(<FirstSteps state={{ openFolderPaths: ["/Users/dev/fw"] }} {...handlers} />)
		const sampleRow = screen.getByTestId("first-steps-row-openProject")
		expect(sampleRow).toHaveTextContent("Open your project")
		expect(screen.getByTestId("first-steps-row-sample")).toContainElement(screen.getByText("Show me"))
	})

	it("fires the row's own action from the 'Show me' pill", () => {
		const onRunSample = vi.fn()
		render(<FirstSteps state={{}} {...handlers} onRunSample={onRunSample} />)
		fireEvent.click(screen.getByText("Show me"))
		expect(onRunSample).toHaveBeenCalledTimes(1)
	})

	it("dismisses for good — the × hides the card and localStorage remembers it", () => {
		render(<FirstSteps state={{}} {...handlers} />)
		fireEvent.click(screen.getByLabelText("Dismiss First steps"))
		expect(screen.queryByTestId("first-steps")).not.toBeInTheDocument()
		expect(localStorage.getItem("adsum.firstSteps.dismissed")).toBe("1")
	})

	it("never renders once already dismissed", () => {
		localStorage.setItem("adsum.firstSteps.dismissed", "1")
		render(<FirstSteps state={{}} {...handlers} />)
		expect(screen.queryByTestId("first-steps")).not.toBeInTheDocument()
	})
})
