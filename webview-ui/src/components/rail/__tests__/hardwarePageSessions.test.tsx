import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * [0.5.1 bench] A session opened from a Hardware page button was a tab titled "New session", and every press
 * opened one more tab even when a session already held the unit. Each button now tells the host what its tab
 * is called, and the unit's own buttons say which unit they are about (the guard's name for it), so the host
 * can continue in the session that holds it. A flash names its tab and no unit: it always gets its own session.
 * The host is stubbed at the service client; what it is asked is what this pins.
 */
const asked: Array<Record<string, unknown>> = []
let units: unknown[] = []

vi.mock("@/services/grpc-client", async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown>
	return {
		...real,
		// The client's methods are class statics (not enumerable), so a spread would drop them: wrap instead.
		AdsumServiceClient: new Proxy(real.AdsumServiceClient as object, {
			get(target, prop, receiver) {
				if (prop === "openSession") {
					return async (req: { value: string }) => {
						asked.push(JSON.parse(req.value))
						return { value: "" }
					}
				}
				if (prop === "firmware") {
					return async () => ({ value: JSON.stringify({ ok: true, rows: [flashRow] }) })
				}
				return Reflect.get(target, prop, receiver)
			},
		}),
	}
})

import { ExtensionStateContext, ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import RailView from "../RailView"

const flashRow = {
	entry: {
		id: "adsum/firmware/lbg20x-demo",
		version: "1.0.0",
		family: "lbg20x",
		rung: "demo",
		group: "blg20-demo-hex",
		title: "LBG20x demo pair",
		summary: null,
		security: false,
		released_at: null,
		entitled: true,
		artifacts: [{ path: "usb/release.json", sha256: "ab", size: 10 }],
		licence: { id: "demo", termMonths: 12 },
	},
	local: {
		folder: "/ws/firmware/lbg20x/1.0.0",
		intact: true,
		receipt: {
			licensee: "dev@example.test",
			term_end: "2027-10-10T00:00:00Z",
			status: "active",
			downloaded_at: "2026-10-10T00:00:00Z",
			artifacts: [{ path: "usb/release.json" }, { path: "usb/demo/ble.signed.bin" }],
		},
	},
	state: "flash",
	folder: "/ws/firmware/lbg20x/1.0.0",
}

// As the service tool's scan reported the bench unit: in range over Bluetooth, no service port on USB.
const LBG = {
	via: "ble",
	family: "lbg20x",
	confirmed: true,
	name: "AD50",
	bleAddress: "D3:58:8E:7A:AD:50",
	bleId: "D3588E7AAD50",
	bonded: true,
	windowOpen: true,
}
const BLG = {
	via: "usb",
	family: "blg20x",
	confirmed: true,
	serialNumber: "BBA605799DE4043E",
	name: "286C",
	servicePort: "/dev/ttyACM4",
}

const state = () => ({
	didHydrateState: true,
	taskHistory: [],
	openFolderPaths: ["/Users/dev/gateway-fw"],
	workspaceRoots: ["/Users/dev/gateway-fw"],
	workspaceClassification: "nrf",
	workspaceFeatures: { hasBle: true, hasWifi: false, hasComplianceArtifacts: false },
	platform: "linux",
	nrfEnvironment: { status: "ready", extensionPresent: true, nrfutilPresent: true, boards: [], blg20Units: units },
	espEnvironment: { status: "ready", extensionPresent: false, idfPresent: false, espDevices: [] },
	apiConfiguration: { actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" },
	mode: "act",
	adsumAccount: { email: "dev@example.test", name: "Dev", emailVerified: true, groups: ["blg20-demo-hex"], openRequests: [] },
	openSessions: [],
	showSettings: false,
	showHistory: false,
})

const Harness = () => {
	const real = useExtensionState()
	return (
		<ExtensionStateContext.Provider value={{ ...real, ...state() } as never}>
			<RailView initialPage="hardware" />
		</ExtensionStateContext.Provider>
	)
}
const draw = () =>
	render(
		<ExtensionStateContextProvider>
			<Harness />
		</ExtensionStateContextProvider>,
	)

beforeEach(() => {
	asked.length = 0
	units = [LBG]
})

describe("what a Hardware page button asks the host for", () => {
	it("the unit's own actions name their tab and the unit, over Bluetooth", async () => {
		draw()
		fireEvent.click(await screen.findByTestId("unit-action-passport"))
		fireEvent.click(screen.getByTestId("unit-action-claim"))
		fireEvent.click(screen.getByTestId("unit-action-logs"))
		expect(asked.map((a) => a.title)).toEqual([
			"What is this gateway? · LBG20x AD50",
			"Claim · LBG20x AD50",
			"Logs · LBG20x AD50",
		])
		for (const a of asked) {
			expect(a.send).toBe(true)
			expect(a.unit).toBe("BLE:AD50")
			expect(String(a.prompt)).toContain("--ble AD50")
		}
	})

	it("Set it up names its tab and the unit by the door its prompt uses", async () => {
		draw()
		fireEvent.click(await screen.findByTestId("ladder-setup-start"))
		expect(asked).toHaveLength(1)
		expect(asked[0]).toMatchObject({ send: true, title: "Set up LBG20x AD50", unit: "BLE:AD50" })
		expect(String(asked[0].prompt)).toContain("over Bluetooth")
	})

	it("on its cable the unit is named by its service port, as the guard stores it", async () => {
		units = [BLG]
		draw()
		fireEvent.click(await screen.findByTestId("unit-action-logs"))
		fireEvent.click(screen.getByTestId("ladder-setup-start"))
		expect(asked[0]).toMatchObject({ send: true, title: "Logs · BLG20x 286C", unit: "/DEV/TTYACM4" })
		expect(asked[1]).toMatchObject({ send: true, title: "Set up BLG20x 286C", unit: "/DEV/TTYACM4" })
		expect(String(asked[1].prompt)).toContain("USB-C service port")
	})

	it("Flash names its tab and no unit: a flash always gets a session of its own", async () => {
		draw()
		fireEvent.click(await screen.findByRole("button", { name: /^Flash v1\.0\.0/ }))
		expect(asked).toHaveLength(1)
		expect(asked[0]).toMatchObject({ send: true, title: "Flash LBG20x demo pair v1.0.0" })
		expect("unit" in asked[0]).toBe(false)
		expect(String(asked[0].prompt)).toContain("Flash LBG20x demo pair v1.0.0")
	})

	it("a button that only fills the box sends nothing and claims no unit", async () => {
		draw()
		fireEvent.click(await screen.findByTestId("ladder-start"))
		expect(asked).toHaveLength(1)
		expect(asked[0].send).toBe(false)
		expect("unit" in asked[0]).toBe(false)
	})
})
