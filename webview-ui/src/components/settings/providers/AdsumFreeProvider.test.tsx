import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))

import { AdsumFreeProvider } from "./AdsumFreeProvider"

describe("AdsumFreeProvider", () => {
	it("is one line plus an Info, not two paragraphs of explanation", () => {
		state.current = {}
		render(<AdsumFreeProvider currentMode="act" />)
		expect(screen.getByText("Adsum free tier · no key needed")).toBeInTheDocument()
		expect(screen.getByLabelText("Details")).toBeInTheDocument()
		// No standing paragraph text left over from the old two-paragraph explainer.
		expect(screen.queryByText(/inference is provided by Adsum Networks/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/thinking controls shown for other providers/i)).not.toBeInTheDocument()
	})

	it("keeps the tokens pill when a remaining balance is known", () => {
		state.current = { freeTierRemainingTokens: 42_000 }
		render(<AdsumFreeProvider currentMode="act" />)
		expect(screen.getByText("42,000 tokens left")).toBeInTheDocument()
	})

	it("keeps the invite-code link", () => {
		state.current = {}
		render(<AdsumFreeProvider currentMode="act" />)
		expect(screen.getByRole("button", { name: /Have an invite code/i })).toBeInTheDocument()
	})
})
