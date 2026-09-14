import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import OpenRouterRouting, { hasRoutingValues, routingSummary } from "../OpenRouterRouting"

/**
 * The two rules a developer meets on this block, and both were learned from a real evening: a sort
 * field that silently reorders everything after a named list, and a ceiling that quietly excludes
 * the fallback you named.
 */
const model = { maxTokens: 8192, contextWindow: 128000, supportsImages: false, inputPrice: 0.6, outputPrice: 2.4 } as never

describe("the Routing block", () => {
	it("shows only the preference and the opener on a fresh configuration", () => {
		render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{}} />)
		// What an OpenRouter developer saw before this feature: a preference, and nothing else.
		expect(screen.getByTestId("routing-sort")).toBeTruthy()
		expect(screen.getByTestId("routing-toggle")).toBeTruthy()
		expect(screen.queryByTestId("routing-sellers")).toBeNull()
		expect(screen.queryByTestId("routing-max-input")).toBeNull()
		expect(screen.queryByTestId("routing-extra")).toBeNull()
		// Nothing set, nothing said.
		expect(screen.queryByTestId("routing-summary")).toBeNull()
	})

	it("opens on a configuration that already carries routing choices", () => {
		render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{ sellerOrder: "together" }} />)
		expect(screen.getByTestId("routing-sellers")).toBeTruthy()
		expect(hasRoutingValues({ sellerOrder: "together" })).toBe(true)
		expect(hasRoutingValues({})).toBe(false)
	})

	it("keeps what was set when the section is closed, and says so in one line", () => {
		const onChange = vi.fn()
		const values = { sellerOrder: "together, deepinfra, fireworks", maxInputPrice: "0.90" }
		render(<OpenRouterRouting modelInfo={model} onChange={onChange} values={values} />)
		expect((screen.getByTestId("routing-sellers") as HTMLInputElement).value).toBe(values.sellerOrder)

		fireEvent.click(screen.getByTestId("routing-toggle"))
		// Hidden, never discarded: collapsing must not write anything.
		expect(screen.queryByTestId("routing-sellers")).toBeNull()
		expect(onChange).not.toHaveBeenCalled()
		expect(screen.getByTestId("routing-summary").textContent).toBe("3 sellers named · price capped")

		fireEvent.click(screen.getByTestId("routing-toggle"))
		expect((screen.getByTestId("routing-sellers") as HTMLInputElement).value).toBe(values.sellerOrder)
		expect((screen.getByTestId("routing-max-input") as HTMLInputElement).value).toBe("0.90")
	})

	it("summarises exactly what is set, and says nothing when nothing is", () => {
		expect(routingSummary({})).toBe("")
		expect(routingSummary({ sellerOrder: "together" })).toBe("1 seller named")
		expect(routingSummary({ sellerOrder: "a, b", onlyTheseSellers: true, maxOutputPrice: "2" })).toBe(
			"2 sellers named · no substitutes · price capped",
		)
		expect(routingSummary({ requireToolCalls: false })).toBe("tool support not required")
		expect(routingSummary({ extraBody: '{"a":1}' })).toBe("extra request body")
	})

	it("greys the preference and says why, as soon as sellers are named", () => {
		const { rerender } = render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{}} />)
		expect((screen.getByTestId("routing-sort") as HTMLSelectElement).disabled).toBe(false)
		expect(screen.queryByTestId("routing-sort-reason")).toBeNull()

		rerender(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{ sellerOrder: "together, deepinfra" }} />)
		expect((screen.getByTestId("routing-sort") as HTMLSelectElement).disabled).toBe(true)
		expect(screen.getByTestId("routing-sort-reason").textContent).toContain("Not used while you have named sellers")
	})

	it("shows the live price, and warns when the ceiling is under it", () => {
		const { rerender } = render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{ maxInputPrice: "1.00" }} />)
		// A ceiling is a routing value, so this configuration opens on it.
		expect(screen.getByTestId("routing-live-price").textContent).toContain("$0.60/M")
		expect(screen.queryByTestId("routing-ceiling-warning")).toBeNull()

		rerender(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{ maxInputPrice: "0.10" }} />)
		expect(screen.getByTestId("routing-ceiling-warning").textContent).toContain("router would skip it")
	})

	it("defaults to what an existing configuration already does — tools required, nothing else set", () => {
		render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{}} />)
		fireEvent.click(screen.getByTestId("routing-toggle"))
		expect((screen.getByTestId("routing-require-tools") as HTMLInputElement).checked).toBe(true)
		expect((screen.getByTestId("routing-only-these") as HTMLInputElement).checked).toBe(false)
		expect((screen.getByTestId("routing-sellers") as HTMLInputElement).value).toBe("")
		expect((screen.getByTestId("routing-extra") as HTMLTextAreaElement).value).toBe("")
	})

	it("reports every change under the name the settings store uses", () => {
		const onChange = vi.fn()
		render(<OpenRouterRouting modelInfo={model} onChange={onChange} values={{}} />)
		fireEvent.click(screen.getByTestId("routing-toggle"))
		fireEvent.change(screen.getByTestId("routing-extra"), { target: { value: '{"reasoning_effort":"high"}' } })
		expect(onChange).toHaveBeenCalledWith("extraBody", '{"reasoning_effort":"high"}')
	})

	it("says plainly what leaving substitutions on means", () => {
		render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{}} />)
		fireEvent.click(screen.getByTestId("routing-toggle"))
		expect(screen.getByTestId("openrouter-routing").textContent).toContain("including reduced-precision copies")
	})
})
