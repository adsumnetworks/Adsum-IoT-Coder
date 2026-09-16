import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import GatewayLadder from "../GatewayLadder"

/**
 * An account that holds BLG20x access sees the BLG20x card, board on the desk or not.
 *
 * 17 Sep: the card was gated on detecting the board alone. After a clean reload the probe identities did
 * not reach the welcome screen, and a developer whose account held the BLG20x groups saw no BLG20x card
 * at all — only the LEW840x demo. Access is something the account knows for certain; it should not depend
 * on a probe scan landing in time. Detection still adds what it adds: the "Seen here" line.
 */

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: { requestAccess: async () => ({ value: "{}" }) },
	StateServiceClient: { captureEntryEvent: () => ({ catch: () => {} }) },
}))

const account = (groups: string[]) => ({
	adsumAccount: { email: "dev@example.com", name: "Dev", emailVerified: true, groups },
})
const ladder = () => render(<GatewayLadder onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />)

beforeEach(() => {
	state.current = {}
})

describe("BLG20x card — shown by access, not only by detection", () => {
	it("an account holding BLG20x early access sees the card with no board detected", () => {
		state.current = account(["blg20-early-access", "blg20-demo-hex"])
		ladder()
		const card = screen.getByTestId("gateway-ladder")
		expect(card.textContent).not.toContain("Seen here")
		expect(card.textContent).toContain("BLG20x")
	})

	it.each(["blg20-prod-hex", "blg20-9151-src", "blg20-ble-src", "blg20-adv-ble", "blg20-adv-full"])(
		"holding %s is access too",
		(group) => {
			state.current = account([group])
			const { container } = ladder()
			expect(container.querySelector("[data-testid='gateway-ladder']")).not.toBeNull()
		},
	)

	it("the demo group alone is not access — it may be granted to every registered account", () => {
		state.current = account(["blg20-demo-hex"])
		const { container } = ladder()
		expect(container.querySelector("[data-testid='gateway-ladder']")).toBeNull()
	})

	it("no access and no board: no card", () => {
		state.current = account([])
		const { container } = ladder()
		expect(container.querySelector("[data-testid='gateway-ladder']")).toBeNull()
	})
})
