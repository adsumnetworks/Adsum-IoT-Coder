import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import AiLimitationsFooter, { AI_LIMITATIONS_TEXT, DISCLAIMER_URL } from "../AiLimitationsFooter"

describe("AiLimitationsFooter", () => {
	it("renders the design A6 copy: AI-based + can make mistakes", () => {
		render(<AiLimitationsFooter />)
		const el = screen.getByTestId("ai-limitations-footer")
		expect(el.textContent).toContain(AI_LIMITATIONS_TEXT)
		expect(AI_LIMITATIONS_TEXT).toBe("Adsum is an AI-based coding agent and can make mistakes.")
	})

	it("renders a 'Full disclaimer →' link to the live docs disclaimer page (no 404)", () => {
		render(<AiLimitationsFooter />)
		const link = screen.getByTestId("ai-limitations-link")
		expect(link.textContent).toMatch(/Full disclaimer/)
		expect(link).toHaveAttribute("href", DISCLAIMER_URL)
		expect(DISCLAIMER_URL).toMatch(/^https:\/\/docs\.adsumnetworks\.com\/legal\/limitations$/)
		expect(link).toHaveAttribute("target", "_blank")
	})

	it("merges caller style overrides", () => {
		render(<AiLimitationsFooter style={{ marginTop: "6px" }} />)
		expect(screen.getByTestId("ai-limitations-footer").style.marginTop).toBe("6px")
	})
})
