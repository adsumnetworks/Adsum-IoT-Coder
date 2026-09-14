import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AccountChip from "../AccountChip"
import CellularGroup from "../CellularGroup"
import DemoHexCard from "../DemoHexCard"
import UnlockedCard from "../UnlockedCard"
import { DEMO_HEX_PROMPT } from "../welcomeIntents"

/**
 * W-09…W-13 — the minute after signing in.
 *
 * What these protect is the answer to "what did that get me?". A surface that silently changes four
 * card frames does not answer it, and a demo whose limits are discovered after the download is a
 * demo that gets returned — so the copy that states them is pinned here, verbatim.
 */

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: { startSignIn: async () => ({ value: "" }), refreshAccount: async () => ({}) },
	StateServiceClient: { captureEntryEvent: () => ({ catch: () => {} }) },
}))
vi.mock("../entryTelemetry", () => ({ gateShown: vi.fn(), entryRunStart: vi.fn() }))

const account = (groups: string[], over: Record<string, unknown> = {}) => ({
	adsumAccount: { email: "ismail@adsumnetworks.com", name: "Ismail", emailVerified: true, groups },
	...over,
})

beforeEach(() => {
	state.current = {}
})

describe("W — registered", () => {
	it("W-09 the account chip names the person, and says nothing at all when nobody is signed in", () => {
		const { container: empty } = render(<AccountChip />)
		expect(empty.querySelector('[data-testid="account-chip"]')).toBeNull()

		state.current = account(["cellular-advanced"])
		render(<AccountChip />)
		const chip = screen.getByTestId("account-chip")
		expect(chip.textContent).toContain("ismail@adsumnetworks.com")
		expect(chip.textContent).toContain("· Registered")
		// The avatar initial comes from the NAME when there is one — an email initial for "Ismail" would
		// be the same letter here by luck, so the case that matters is a name that differs.
		expect(chip.textContent?.startsWith("I")).toBe(true)

		state.current = account([], { adsumAccount: { email: "zoe@x.io", name: "", emailVerified: true, groups: [] } })
		render(<AccountChip />)
		expect(screen.getAllByTestId("account-chip").at(-1)?.textContent?.startsWith("Z")).toBe(true)
	})

	it("W-10 the unlocked card names what is now theirs and what still is not", () => {
		const onDismiss = vi.fn()
		render(<UnlockedCard onDismiss={onDismiss} />)
		expect(screen.getByText("You’re registered — cellular is unlocked")).toBeTruthy()
		expect(screen.getByText("Advanced cellular knowledge: LTE-M, NB-IoT, NTN, DECT NR+")).toBeTruthy()
		expect(screen.getByText("On-device inference on nRF54")).toBeTruthy()
		expect(screen.getByText("Fanstel LEW840x demo hexes")).toBeTruthy()
		// The honest half: saying it here is what stops the next click being a disappointment.
		expect(screen.getByText("Template source is by request — the LEW840x card has the link.")).toBeTruthy()

		fireEvent.click(screen.getByTestId("unlocked-dismiss"))
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	it("W-11 the demo card states both limits before the click, not after", async () => {
		state.current = account(["lew840x-demo-hex"])
		const onFlash = vi.fn()
		render(<DemoHexCard onFlash={onFlash} />)
		expect(screen.getByText("Flash the LEW840x demo")).toBeTruthy()
		expect(
			screen.getByText(
				/Three signed hexes: BLE scanner, ESP32 uplink, nRF9160 bearer\. Needs nrfutil and esptool on this machine\./,
			),
		).toBeTruthy()
		// The limits are their own line ABOVE the action, not a clause at the end of the description.
		expect(screen.getByText("Wi-Fi and Ethernet unlimited")).toBeTruthy()
		expect(screen.getByText("Cellular in 60-minute sessions, for evaluation")).toBeTruthy()
		expect(screen.getByText("≈ 3 min · you will be asked for the ports")).toBeTruthy()

		await act(async () => {
			fireEvent.click(screen.getByTestId("demo-hex-flash"))
		})
		expect(onFlash).toHaveBeenCalledTimes(1)
	})

	it("W-11b flashing replaces the button, so nobody starts it twice", () => {
		state.current = account(["lew840x-demo-hex"])
		render(<DemoHexCard flashing="nRF9160 bearer… 2 of 3" onFlash={vi.fn()} />)
		expect(screen.getByTestId("demo-hex-flashing").textContent).toBe("Flashing nRF9160 bearer… 2 of 3")
		expect(screen.queryByTestId("demo-hex-flash")).toBeNull()
	})

	it("W-11c without the demo-hex grant the card is not there at all", () => {
		state.current = account(["cellular-advanced"])
		render(<DemoHexCard onFlash={vi.fn()} />)
		expect(screen.queryByTestId("demo-hex-card")).toBeNull()

		// `all` is the wildcard, so staff and partners see it without a row per family.
		state.current = account(["all"])
		render(<DemoHexCard onFlash={vi.fn()} />)
		expect(screen.getByTestId("demo-hex-card")).toBeTruthy()
	})

	it("W-12 the demo prompt loads the tool bit and states the cap before flashing, not after", () => {
		expect(DEMO_HEX_PROMPT).toContain("LOAD the lew840x demo-hex tool bit first")
		expect(DEMO_HEX_PROMPT).toContain("nrfutil and esptool")
		expect(DEMO_HEX_PROMPT).toMatch(/60-minute sessions .* before I start, not after|before I \n?start, not after/s)
	})

	it("W-13 a registered developer sees four live cards and no instruction to register", () => {
		state.current = account(["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"])
		const onStartTask = vi.fn()
		render(<CellularGroup onSelectMode={vi.fn()} onStartTask={onStartTask} />)
		expect(screen.queryByText("Register")).toBeNull()
		expect(screen.queryByTestId("cellular-note")).toBeNull()

		fireEvent.click(screen.getByTestId("cellular-card-cellularGateway"))
		expect(onStartTask).toHaveBeenCalledTimes(1)
		expect(screen.queryByTestId("gate-panel")).toBeNull()
	})
})
