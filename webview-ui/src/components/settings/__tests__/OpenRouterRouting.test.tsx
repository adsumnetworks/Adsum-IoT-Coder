import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import OpenRouterRouting from "../OpenRouterRouting"

/**
 * The two rules a developer meets on this block, and both were learned from a real evening: a sort
 * field that silently reorders everything after a named list, and a ceiling that quietly excludes
 * the fallback you named.
 */
const model = { maxTokens: 8192, contextWindow: 128000, supportsImages: false, inputPrice: 0.6, outputPrice: 2.4 } as never

describe("the Routing block", () => {
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
		expect(screen.getByTestId("routing-live-price").textContent).toContain("$0.60/M")
		expect(screen.queryByTestId("routing-ceiling-warning")).toBeNull()

		rerender(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{ maxInputPrice: "0.10" }} />)
		expect(screen.getByTestId("routing-ceiling-warning").textContent).toContain("router would skip it")
	})

	it("defaults to what an existing configuration already does — tools required, nothing else set", () => {
		render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{}} />)
		expect((screen.getByTestId("routing-require-tools") as HTMLInputElement).checked).toBe(true)
		expect((screen.getByTestId("routing-only-these") as HTMLInputElement).checked).toBe(false)
		expect((screen.getByTestId("routing-sellers") as HTMLInputElement).value).toBe("")
		expect((screen.getByTestId("routing-extra") as HTMLTextAreaElement).value).toBe("")
	})

	it("reports every change under the name the settings store uses", () => {
		const onChange = vi.fn()
		render(<OpenRouterRouting modelInfo={model} onChange={onChange} values={{}} />)
		fireEvent.change(screen.getByTestId("routing-extra"), { target: { value: '{"reasoning_effort":"high"}' } })
		expect(onChange).toHaveBeenCalledWith("extraBody", '{"reasoning_effort":"high"}')
	})

	it("says plainly what leaving substitutions on means", () => {
		render(<OpenRouterRouting modelInfo={model} onChange={vi.fn()} values={{}} />)
		expect(screen.getByTestId("openrouter-routing").textContent).toContain("including reduced-precision copies")
	})
})
