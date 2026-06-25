import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import AiLimitationsFooter, { AI_LIMITATIONS_TEXT } from "../AiLimitationsFooter"

describe("AiLimitationsFooter", () => {
	it("renders the approved AI-limitations disclaimer copy", () => {
		render(<AiLimitationsFooter />)
		const el = screen.getByTestId("ai-limitations-footer")
		expect(el.textContent).toBe(AI_LIMITATIONS_TEXT)
		expect(el.textContent).toMatch(/review its changes before you flash or ship/)
	})

	it("merges caller style overrides", () => {
		render(<AiLimitationsFooter style={{ marginTop: "6px" }} />)
		expect(screen.getByTestId("ai-limitations-footer").style.marginTop).toBe("6px")
	})
})
