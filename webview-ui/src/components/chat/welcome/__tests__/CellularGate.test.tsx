import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CellularGroup from "../CellularGroup"
import GatePanel from "../GatePanel"
import IntentCard from "../IntentCard"
import { CELLULAR_INTENTS, cellularHint } from "../welcomeIntents"

/**
 * W-01…W-08 — the gate as the developer meets it.
 *
 * The rule these protect is not "a lock renders". It is that a locked card can never start the work
 * it names, that what the gate says is true (free, no card, browser sign-in), and that the three
 * honest failures each say what happened rather than spinning. Enforcement is the registry's — these
 * cases are about the promise the surface makes.
 */

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const rpc = vi.hoisted(() => ({ startSignIn: vi.fn(), refreshAccount: vi.fn() }))
const telemetry = vi.hoisted(() => ({ gateShown: vi.fn(), entryRunStart: vi.fn() }))

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: {
		startSignIn: (...a: unknown[]) => rpc.startSignIn(...a) ?? Promise.resolve({ value: "" }),
		refreshAccount: (...a: unknown[]) => rpc.refreshAccount(...a) ?? Promise.resolve({}),
	},
	StateServiceClient: { captureEntryEvent: () => ({ catch: () => {} }) },
}))
vi.mock("../entryTelemetry", () => ({
	gateShown: (...a: unknown[]) => telemetry.gateShown(...a),
	entryRunStart: (...a: unknown[]) => telemetry.entryRunStart(...a),
}))

const handlers = () => ({ onSelectMode: vi.fn(), onStartTask: vi.fn() })
const signedIn = (groups: string[]) => ({
	adsumAccount: { email: "dev@example.com", name: "Dev", emailVerified: true, groups },
})

beforeEach(() => {
	state.current = {}
	rpc.startSignIn.mockReset().mockResolvedValue({ value: "" })
	rpc.refreshAccount.mockReset().mockResolvedValue({})
	telemetry.gateShown.mockReset()
	telemetry.entryRunStart.mockReset()
})

describe("W — the register gate", () => {
	it("W-01 a locked card carries the lock and the Register chip, and cannot start its work", () => {
		const onClick = vi.fn()
		const onLocked = vi.fn()
		const { container } = render(
			<IntentCard
				description="Fanstel LEW840x or BLG20: BLE in, cellular out, one code base."
				icon="radio-tower"
				locked={true}
				onClick={onClick}
				onLocked={onLocked}
				pill="Register"
				testId="locked-card"
				title="LTE-M / NB-IoT gateway"
			/>,
		)
		const card = screen.getByTestId("locked-card")
		// Solid, never dashed: dashed already means "on the roadmap", and this is available the moment
		// you register.
		expect(card.style.border).toContain("solid")
		expect(card.style.border).toContain("2px")
		expect(card.style.border).toContain("18%")
		expect(container.querySelector(".codicon-lock")).not.toBeNull()
		expect(screen.getByText("Register")).toBeTruthy()

		fireEvent.click(card)
		expect(onLocked).toHaveBeenCalledTimes(1)
		expect(onClick).not.toHaveBeenCalled()
	})

	it("W-01b the same card unlocked runs its work and shows its own icon", () => {
		const onClick = vi.fn()
		const onLocked = vi.fn()
		const { container } = render(
			<IntentCard
				description="d"
				icon="radio-tower"
				onClick={onClick}
				onLocked={onLocked}
				testId="live-card"
				title="LTE-M / NB-IoT gateway"
			/>,
		)
		fireEvent.click(screen.getByTestId("live-card"))
		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onLocked).not.toHaveBeenCalled()
		expect(container.querySelector(".codicon-radio-tower")).not.toBeNull()
	})

	it("W-02 anonymous: the group label carries the note and all four cards are locked, in order", () => {
		render(<CellularGroup {...handlers()} />)
		expect(screen.getByText("Cellular & gateways")).toBeTruthy()
		expect(screen.getByTestId("cellular-note").textContent).toBe("· free account · no card")

		const titles = CELLULAR_INTENTS.map((i) => i.title)
		expect(titles).toEqual([
			"LTE-M / NB-IoT gateway",
			"Satellite NB-NTN bring-up",
			"nRF91 modem bring-up",
			"On-device inference",
		])
		for (const intent of CELLULAR_INTENTS) {
			expect(screen.getByTestId(`cellular-card-${intent.id}`)).toBeTruthy()
		}
		expect(screen.getAllByText("Register")).toHaveLength(4)
	})

	it("W-02b registered: the note is gone, the cards run, and a partial grant locks only what it must", () => {
		const h = handlers()
		state.current = signedIn(["cellular-advanced"])
		render(<CellularGroup {...h} />)
		// cellular-advanced opens three; edge-ai-advanced is a separate grant and stays locked.
		expect(screen.getAllByText("Register")).toHaveLength(1)
		expect(screen.queryByTestId("cellular-note")).toBeNull()

		fireEvent.click(screen.getByTestId("cellular-card-nrf91BringUp"))
		expect(h.onStartTask).toHaveBeenCalledTimes(1)
		expect(String(h.onStartTask.mock.calls[0][0])).toContain("nRF91")

		// The one still locked opens the gate instead of running.
		fireEvent.click(screen.getByTestId("cellular-card-edgeAi"))
		expect(h.onStartTask).toHaveBeenCalledTimes(1)
		expect(screen.getByTestId("gate-panel")).toBeTruthy()
	})

	it("W-02c the ACTUAL free tier unlocks all four — the state the operator was in when none of them did", () => {
		// Not ["all"] (a steward) and not a partial grant (W-02b) — this is the literal list
		// REGISTERED_TIER hands every account the moment it exists, and it is the shape that was
		// broken: the chip said Registered, the card said "cellular is unlocked", and all four stayed
		// locked because registering wrote no entitlement row at all.
		const h = handlers()
		state.current = signedIn(["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex", "blg20-demo-hex"])
		render(<CellularGroup {...h} />)

		expect(screen.queryAllByText("Register")).toHaveLength(0)
		expect(screen.queryByTestId("gate-panel")).toBeNull()
		expect(screen.queryByTestId("cellular-note")).toBeNull()

		// Every one of the four runs its work rather than reopening the panel they just completed.
		for (const id of ["cellularGateway", "ntnBringUp", "nrf91BringUp", "edgeAi"]) {
			fireEvent.click(screen.getByTestId(`cellular-card-${id}`))
		}
		expect(h.onStartTask).toHaveBeenCalledTimes(4)
		expect(screen.queryByTestId("gate-panel")).toBeNull()
	})

	it("W-03 a detected cellular board earns a hint line; anything else earns none", () => {
		expect(cellularHint(["nRF9160 DK"])).toBe("Your nRF9160 DK is detected — register to unlock its attach and APN recipes.")
		expect(cellularHint(["nRF52840 DK"])).toBeUndefined()
		expect(cellularHint([])).toBeUndefined()

		render(<CellularGroup {...handlers()} boards={["nRF9160 DK"]} />)
		expect(screen.getByTestId("cellular-hint").textContent).toBe(
			"Your nRF9160 DK is detected — register to unlock its attach and APN recipes.",
		)
	})

	it("W-03b once registered the hint is gone — it was a reason to register, not a fact about the board", () => {
		state.current = signedIn(["all"])
		render(<CellularGroup {...handlers()} boards={["nRF9160 DK"]} />)
		expect(screen.queryByTestId("cellular-hint")).toBeNull()
	})

	it("W-04 the default gate says what it unlocks, offers three providers, and never says Pro", async () => {
		render(<GatePanel onClose={vi.fn()} open={true} />)
		expect(screen.getByText("Register to unlock cellular")).toBeTruthy()
		expect(screen.getByText("A free account. It unlocks:")).toBeTruthy()
		for (const bullet of [
			"LTE-M, NB-IoT, NTN and DECT NR+ knowledge and tools",
			"On-device inference on nRF54",
			"The Fanstel gateway demo hexes",
			"Template source, by request",
		]) {
			expect(screen.getByText(bullet)).toBeTruthy()
		}
		expect(screen.getByTestId("gate-provider-github").textContent).toContain("Continue with GitHub")
		expect(screen.getByTestId("gate-provider-email").textContent).toContain("Continue with email")
		// Every provider offered here must be one that actually works. Google is parked until it has an
		// OAuth app (operator, 2026-09-06): the backend answers /auth/unavailable for it, so a button
		// would teach a developer only that we are broken. This is the guarantee, not the list —
		// re-adding Google is fine the day the credentials exist.
		expect(screen.queryByTestId("gate-provider-google")).toBeNull()
		expect(document.body.textContent).not.toMatch(/Google/i)
		expect(screen.getByText(/Free\. No card\. You sign in in your browser and come straight back here\./)).toBeTruthy()
		expect(document.body.textContent).not.toMatch(/\bPro\b/)

		await act(async () => {
			fireEvent.click(screen.getByTestId("gate-provider-github"))
		})
		expect(rpc.startSignIn).toHaveBeenCalledTimes(1)
	})

	it("W-05 offline says so, and does not pretend the rest of the product is affected", async () => {
		render(<GatePanel onClose={vi.fn()} open={true} variant="offline" />)
		expect(screen.getByText("Registering needs internet")).toBeTruthy()
		expect(
			screen.getByText(
				/Adsum can’t be reached right now\. Your BLE, Wi-Fi and Ethernet work is unaffected — the cellular cards stay locked until you’re back online\./,
			),
		).toBeTruthy()
		await act(async () => {
			fireEvent.click(screen.getByTestId("gate-retry"))
		})
		expect(rpc.refreshAccount).toHaveBeenCalledTimes(1)
		expect(screen.getByText("Not now")).toBeTruthy()
	})

	it("W-06 verify-pending names the address and says the panel updates itself", () => {
		render(<GatePanel email="ismail@adsumnetworks.com" onClose={vi.fn()} open={true} variant="verify" />)
		expect(screen.getByText("Check your inbox")).toBeTruthy()
		expect(screen.getByText("ismail@adsumnetworks.com")).toBeTruthy()
		expect(screen.getByText(/Open it to finish — this panel updates by itself\./)).toBeTruthy()
		expect(screen.getByTestId("gate-resend")).toBeTruthy()
		expect(screen.getByText("Later")).toBeTruthy()
		expect(screen.getByText("Start again")).toBeTruthy()
	})

	it("W-07 Esc, the × and the scrim all close it, and the cards are still there behind", () => {
		const h = handlers()
		render(<CellularGroup {...h} />)
		const open = () => fireEvent.click(screen.getByTestId("cellular-card-cellularGateway"))

		open()
		fireEvent.click(screen.getByTestId("gate-close"))
		expect(screen.queryByTestId("gate-panel")).toBeNull()

		open()
		fireEvent.click(screen.getByTestId("gate-scrim"))
		expect(screen.queryByTestId("gate-panel")).toBeNull()

		open()
		fireEvent.keyDown(window, { key: "Escape" })
		expect(screen.queryByTestId("gate-panel")).toBeNull()

		// The surface behind is untouched — closing the gate is not a dead end.
		expect(screen.getByTestId("cellular-card-cellularGateway")).toBeTruthy()
		expect(h.onStartTask).not.toHaveBeenCalled()
	})

	it("W-07b the account arriving closes the gate — the sign-in it was asking for is done", () => {
		// Watched on a real desk with the shipped build: the callback lands, the four cards unlock, and
		// the scrim stays up still saying "Register to unlock cellular" over them. The developer did the
		// thing and the panel kept asking.
		const h = handlers()
		const { rerender } = render(<CellularGroup {...h} />)
		fireEvent.click(screen.getByTestId("cellular-card-cellularGateway"))
		expect(screen.getByTestId("gate-panel")).toBeTruthy()

		state.current = signedIn(["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex", "blg20-demo-hex"])
		act(() => {
			rerender(<CellularGroup {...h} />)
		})
		expect(screen.queryByTestId("gate-panel")).toBeNull()
		expect(screen.queryByTestId("gate-scrim")).toBeNull()
		// And it closed because the sign-in finished, not because the card went away.
		expect(screen.getByTestId("cellular-card-cellularGateway")).toBeTruthy()
	})

	it("W-08 the funnel counts one gate_shown per open, naming the surface and the card", () => {
		render(<CellularGroup {...handlers()} />)
		fireEvent.click(screen.getByTestId("cellular-card-ntnBringUp"))
		expect(telemetry.gateShown).toHaveBeenCalledTimes(1)
		expect(telemetry.gateShown).toHaveBeenCalledWith("card", "ntnBringUp")

		// Re-rendering behind an open panel must not count again, or the denominator is meaningless.
		fireEvent.click(screen.getByTestId("gate-scrim"))
		fireEvent.click(screen.getByTestId("cellular-card-ntnBringUp"))
		expect(telemetry.gateShown).toHaveBeenCalledTimes(2)
	})
})
