import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/**
 * [0.5 the firmware lane] The demo rows in the rail open the Hardware page on their family, where the demo
 * is downloaded with its licence and flashed from the folder; they no longer start a session that installs
 * through a tool. The host is stubbed at the service client.
 */
const openSession = vi.fn(async () => ({ value: "" }))
const firmwareCalls: Array<Record<string, unknown>> = []

vi.mock("@/services/grpc-client", async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown>
	return {
		...real,
		// The client's methods are class statics (not enumerable), so a spread would drop them: wrap instead.
		AdsumServiceClient: new Proxy(real.AdsumServiceClient as object, {
			get(target, prop, receiver) {
				if (prop === "openSession") {
					return (...a: unknown[]) => openSession(...(a as []))
				}
				if (prop === "firmware") {
					return async (req: { value: string }) => {
						firmwareCalls.push(JSON.parse(req.value))
						return { value: JSON.stringify({ ok: true, rows: [] }) }
					}
				}
				return Reflect.get(target, prop, receiver)
			},
		}),
	}
})

import { ExtensionStateContext, ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import RailView from "../RailView"

const state = {
	didHydrateState: true,
	taskHistory: [],
	openFolderPaths: ["/Users/dev/gateway-fw"],
	workspaceRoots: ["/Users/dev/gateway-fw"],
	workspaceClassification: "nrf",
	workspaceFeatures: { hasBle: true, hasWifi: false, hasComplianceArtifacts: false },
	nrfEnvironment: {
		status: "ready",
		extensionPresent: true,
		nrfutilPresent: true,
		boards: [],
		blg20Units: [{ via: "usb", confirmed: true, serialNumber: "9802AF5C69DF1E66", name: "286C", family: "blg20x" }],
	},
	espEnvironment: { status: "ready", extensionPresent: false, idfPresent: false, espDevices: [] },
	apiConfiguration: { actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" },
	mode: "act",
	adsumAccount: {
		email: "dev@example.test",
		name: "Dev",
		emailVerified: true,
		groups: ["blg20-demo-hex", "lew840x-demo-hex"],
		openRequests: [],
	},
	openSessions: [],
	showSettings: false,
	showHistory: false,
}

const Harness = () => {
	const real = useExtensionState()
	return (
		<ExtensionStateContext.Provider value={{ ...real, ...state } as never}>
			<RailView initialPalette />
		</ExtensionStateContext.Provider>
	)
}

describe("the demo rows open the Hardware page", () => {
	it("Flash the BLG20x demo pair: the Hardware page on blg20x, no session", async () => {
		render(
			<ExtensionStateContextProvider>
				<Harness />
			</ExtensionStateContextProvider>,
		)
		fireEvent.click(await screen.findByTestId("run-demoPairBlg20"))
		await screen.findByTestId("rail-hardware-page")
		expect(openSession).not.toHaveBeenCalled()
		await waitFor(() => expect(firmwareCalls.some((c) => c.op === "list" && c.family === "blg20x")).toBe(true))
	})
})
