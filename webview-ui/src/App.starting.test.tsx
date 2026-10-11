import { render, screen } from "@testing-library/react"
import type React from "react"
import { describe, expect, it, vi } from "vitest"

/**
 * [0.5.1 bench] Before the host's first state the app rendered nothing, so the page's own loading mark gave way
 * to an empty page: a session tab opened from a button looked dead. It says "Starting…" until the state arrives.
 */
const state = vi.hoisted(() => ({ current: { didHydrateState: false } as Record<string, unknown> }))

vi.mock("./context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("./Providers", () => ({ Providers: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
// The surfaces behind the first state are not what this is about.
vi.mock("./components/chat/ChatView", () => ({ default: () => <div data-testid="chat-view" /> }))
vi.mock("./components/rail/RailView", () => ({ default: () => <div data-testid="rail-view" /> }))
vi.mock("./components/history/HistoryView", () => ({ default: () => null }))
vi.mock("./components/settings/SettingsView", () => ({ default: () => null }))
vi.mock("./components/onboarding/OnboardingView", () => ({ default: () => null }))
vi.mock("./components/welcome/WelcomeView", () => ({ default: () => null }))
vi.mock("./components/worktrees/WorktreesView", () => ({ default: () => null }))
vi.mock("./services/grpc-client", () => ({ UiServiceClient: { onDidShowAnnouncement: vi.fn(() => Promise.resolve({})) } }))

import App from "./App"

describe("the app before the host's first state", () => {
	it("shows a centred Starting… line instead of an empty page", () => {
		state.current = { didHydrateState: false }
		render(<App />)
		const line = screen.getByTestId("starting-placeholder")
		expect(line).toHaveTextContent("Starting…")
		expect(line).toHaveAttribute("role", "status")
		expect(line.style.justifyContent).toBe("center")
		expect(line.style.alignItems).toBe("center")
		expect(screen.queryByTestId("chat-view")).toBeNull()
		expect(screen.queryByTestId("rail-view")).toBeNull()
	})

	it("gives way to the real surface once the state has arrived", () => {
		state.current = { didHydrateState: true, showWelcome: false, sessionsFirstRail: false }
		render(<App />)
		expect(screen.queryByTestId("starting-placeholder")).toBeNull()
		expect(screen.getByTestId("chat-view")).toBeInTheDocument()
	})
})
