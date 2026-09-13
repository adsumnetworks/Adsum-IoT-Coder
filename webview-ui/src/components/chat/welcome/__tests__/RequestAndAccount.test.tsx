import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AccountSection from "../../../settings/sections/AccountSection"
import { KbitLockedRow } from "../../KbitLockedRow"
import CellularGroup from "../CellularGroup"
import RequestAccessForm, { chipsFor, FAMILIES } from "../RequestAccessForm"

/**
 * W-14…W-21 — asking for what a free account does not give you, and the two doors out.
 *
 * The rule under all of it: the developer is never told a thing that is not true. The form says
 * "licensed source" because that is what it is; the Account tab shows groups as words because ids are
 * ours, not theirs; the locked row credits the author because gating access is a commercial decision
 * and taking a byline off would be a different one.
 */

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const rpc = vi.hoisted(() => ({
	requestAccess: vi.fn(),
	signOutAccount: vi.fn(),
	startSignIn: vi.fn(),
	deleteAccount: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: {
		requestAccess: (...a: unknown[]) => rpc.requestAccess(...a),
		signOutAccount: (...a: unknown[]) => rpc.signOutAccount(...a),
		deleteAccount: (...a: unknown[]) => rpc.deleteAccount(...a),
		startSignIn: (...a: unknown[]) => rpc.startSignIn(...a),
		refreshAccount: async () => ({}),
	},
	StateServiceClient: { captureEntryEvent: () => ({ catch: () => {} }) },
}))
vi.mock("../entryTelemetry", () => ({ gateShown: vi.fn(), entryRunStart: vi.fn() }))

const account = (over: Partial<{ groups: string[]; openRequests: string[]; emailVerified: boolean }> = {}) => ({
	adsumAccount: {
		email: "ismail@adsumnetworks.com",
		name: "Ismail",
		emailVerified: over.emailVerified ?? true,
		groups: over.groups ?? ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"],
		openRequests: over.openRequests ?? [],
	},
})
const header = () => null

beforeEach(() => {
	state.current = account()
	rpc.requestAccess.mockReset().mockResolvedValue({ value: JSON.stringify({ ok: true }) })
	rpc.signOutAccount.mockReset().mockResolvedValue({})
	rpc.startSignIn.mockReset().mockResolvedValue({ value: "" })
	rpc.deleteAccount.mockReset().mockResolvedValue({ value: "" })
})

describe("W — asking, and the account tab", () => {
	it("W-14 the form says licensed source, offers both families and three chips, and never promises open source", () => {
		render(<RequestAccessForm onClose={vi.fn()} open={true} />)
		expect(screen.getByText("Request template source access")).toBeTruthy()
		expect(
			screen.getByText(
				/The prebuilt gateway templates are licensed source\. Tell us what you’re building and which chips you need to customise\./,
			),
		).toBeTruthy()
		expect(screen.getByTestId("request-family")).toBeTruthy()
		expect(screen.getByText("Fanstel LEW840x")).toBeTruthy()
		expect(screen.getByText("Fanstel BLG20")).toBeTruthy()
		for (const chip of ["ble-src", "esp-src", "9160-src"]) {
			expect(screen.getByTestId(`request-chip-${chip}`)).toBeTruthy()
		}
		expect(screen.getByTestId("request-message")).toBeTruthy()
		expect(screen.getByText(/one open request per family\./)).toBeTruthy()
		expect(document.body.textContent).not.toMatch(/open[- ]source/i)
	})

	it("W-15 sending posts the family, chips and message, and the sent state names the reply time", async () => {
		const onSent = vi.fn()
		render(<RequestAccessForm onClose={vi.fn()} onSent={onSent} open={true} />)
		fireEvent.click(screen.getByTestId("request-chip-esp-src"))
		fireEvent.change(screen.getByTestId("request-message"), { target: { value: "100 units in Q1" } })
		await act(async () => {
			fireEvent.click(screen.getByTestId("request-send"))
		})
		const sentBody = JSON.parse(rpc.requestAccess.mock.calls[0][0].value)
		expect(sentBody).toEqual({ family: "lew840x", chips: ["ble-src", "esp-src"], message: "100 units in Q1" })
		expect(onSent).toHaveBeenCalledWith("lew840x")
		expect(screen.getByText("Request sent")).toBeTruthy()
		expect(screen.getByText(/We reply within a business day to/)).toBeTruthy()
		expect(screen.getByText(/the source will resolve in your next run\./)).toBeTruthy()
	})

	it("W-15b a second request for the same family says which case it hit, not a generic failure", async () => {
		rpc.requestAccess.mockResolvedValue({ value: JSON.stringify({ ok: false, reason: "already_open" }) })
		render(<RequestAccessForm onClose={vi.fn()} open={true} />)
		await act(async () => {
			fireEvent.click(screen.getByTestId("request-send"))
		})
		expect(screen.getByTestId("request-error").textContent).toBe(
			"You already have an open request for this family — we are still on it.",
		)
		expect(screen.queryByText("Request sent")).toBeNull()

		// Offline is a different sentence, because it is a different thing that happened.
		rpc.requestAccess.mockResolvedValue({ value: JSON.stringify({ ok: false, reason: "offline" }) })
		await act(async () => {
			fireEvent.click(screen.getByTestId("request-send"))
		})
		expect(screen.getByTestId("request-error").textContent).toContain("has not been sent")
	})

	it("W-16 the gateway card's source line reflects the SERVER's view of the request", () => {
		const { unmount } = render(<CellularGroup onSelectMode={vi.fn()} onStartTask={vi.fn()} />)
		expect(screen.getByTestId("source-line").textContent).toBe("Request template source access →")
		unmount()

		state.current = account({ openRequests: ["lew840x"] })
		const second = render(<CellularGroup onSelectMode={vi.fn()} onStartTask={vi.fn()} />)
		expect(screen.getByTestId("source-line").textContent).toBe(
			"Template source: request sent · we reply within a business day",
		)
		second.unmount()

		state.current = account({ groups: ["cellular-advanced", "lew840x-ble-src"] })
		render(<CellularGroup onSelectMode={vi.fn()} onStartTask={vi.fn()} />)
		expect(screen.getByTestId("source-line").textContent).toBe("Template source: granted — it resolves in your next run")
	})

	it("W-17 signed out, the Account tab says what an account is for and offers one door", () => {
		state.current = {}
		render(<AccountSection renderSectionHeader={header} />)
		expect(screen.getByTestId("account-signed-out").textContent).toBe(
			"Not signed in. A free account unlocks LTE-M, NB-IoT, NTN, DECT NR+ and on-device inference — and the Fanstel gateway demo hexes.",
		)
		fireEvent.click(screen.getByTestId("account-signin"))
		expect(screen.getByTestId("gate-panel")).toBeTruthy()
	})

	it("W-18 signed in, groups are shown as words and template source names its state", () => {
		render(<AccountSection renderSectionHeader={header} />)
		const kv = screen.getByTestId("account-kv").textContent ?? ""
		expect(kv).toContain("ismail@adsumnetworks.com")
		// Words, not ids: `cellular-advanced` is a thing our database recognises, not the developer.
		expect(kv).toContain("Advanced cellular · On-device inference · LEW840x demo hexes")
		expect(kv).not.toContain("cellular-advanced")
		expect(screen.getByTestId("account-request")).toBeTruthy()
		expect(kv).toContain("LEW840x hexes available · cellular in 60-minute sessions")
	})

	it("W-18b a pending request and a granted one each say so, and the ask disappears once made", () => {
		state.current = account({ openRequests: ["lew840x"] })
		const { unmount } = render(<AccountSection renderSectionHeader={header} />)
		expect(screen.getByTestId("account-kv").textContent).toContain("LEW840x — request sent, pending")
		expect(screen.queryByTestId("account-request")).toBeNull()
		unmount()

		state.current = account({ groups: ["lew840x-ble-src"] })
		render(<AccountSection renderSectionHeader={header} />)
		expect(screen.getByTestId("account-kv").textContent).toContain("LEW840x BLE source")
	})

	it("W-19 signing out is confirmed, says what locks and what does not, and Cancel changes nothing", () => {
		render(<AccountSection renderSectionHeader={header} />)
		fireEvent.click(screen.getByTestId("account-signout"))
		expect(screen.getByText("Sign out of Adsum?")).toBeTruthy()
		expect(
			screen.getByText("Cellular knowledge and the demo hexes lock again on this machine. Nothing of yours is deleted."),
		).toBeTruthy()

		fireEvent.click(screen.getByText("Cancel"))
		expect(screen.queryByTestId("signout-confirm")).toBeNull()
		expect(rpc.signOutAccount).not.toHaveBeenCalled()

		fireEvent.click(screen.getByTestId("account-signout"))
		fireEvent.click(screen.getByTestId("signout-confirm-yes"))
		expect(rpc.signOutAccount).toHaveBeenCalledTimes(1)
	})

	it("W-20 the locked row credits the author and offers Register — credit is never withheld", () => {
		const onRegister = vi.fn()
		render(
			<KbitLockedRow
				bit={{
					id: "adsum/nrf/protocols/lte-attach",
					title: "nRF91 LTE attach & APN recipes",
					author: "Omar El Sayed",
					group: "cellular-advanced",
				}}
				onRegister={onRegister}
			/>,
		)
		const row = screen.getByTestId("kbit-locked-row")
		expect(row.textContent).toContain("nRF91 LTE attach & APN recipes")
		expect(row.textContent).toContain("curated by")
		expect(screen.getByText("Omar El Sayed")).toBeTruthy()
		expect(row.textContent).toContain("needs a registered account")
		expect(row.querySelector(".codicon-lock")).not.toBeNull()

		fireEvent.click(screen.getByTestId("kbit-locked-register"))
		expect(onRegister).toHaveBeenCalledTimes(1)
	})

	it("W-21 a revoked bit reads differently — telling an account holder to register is nonsense", () => {
		const onRequestAccess = vi.fn()
		render(
			<KbitLockedRow
				bit={{ id: "x/y/z", title: "nRF91 LTE attach & APN recipes", author: "Omar El Sayed", revoked: true }}
				onRegister={vi.fn()}
				onRequestAccess={onRequestAccess}
			/>,
		)
		expect(screen.getByTestId("kbit-locked-row").textContent).toContain("no longer in your account")
		expect(screen.queryByTestId("kbit-locked-register")).toBeNull()
		fireEvent.click(screen.getByTestId("kbit-locked-request"))
		expect(onRequestAccess).toHaveBeenCalledTimes(1)
	})

	it("W-19b deleting is confirmed separately, says what goes and what stays, and a failure does not lie", async () => {
		render(<AccountSection renderSectionHeader={header} />)
		fireEvent.click(screen.getByTestId("account-delete"))
		expect(screen.getByText("Delete your Adsum account?")).toBeTruthy()
		expect(
			screen.getByText(/Your projects, your logs and your free-tier allowance on this machine are not touched\./),
		).toBeTruthy()

		// A failed delete must not close the dialog: closing it would read as "done".
		rpc.deleteAccount.mockResolvedValue({ value: "Adsum can’t be reached right now. Nothing was deleted." })
		await act(async () => {
			fireEvent.click(screen.getByTestId("delete-confirm-yes"))
		})
		expect(screen.getByTestId("delete-error").textContent).toContain("Nothing was deleted")
		expect(screen.getByTestId("delete-confirm")).toBeTruthy()

		rpc.deleteAccount.mockResolvedValue({ value: "" })
		await act(async () => {
			fireEvent.click(screen.getByTestId("delete-confirm-yes"))
		})
		expect(screen.queryByTestId("delete-confirm")).toBeNull()
		expect(rpc.deleteAccount).toHaveBeenCalledTimes(2)
	})

	it("the chips a family offers are that family's real silicon, and every family has some", () => {
		// The point of the change: a BLG20's halves are an nRF54 and an nRF9151, so offering
		// "nRF9160" against one files a request nobody can grant.
		const blg20 = chipsFor("blg20").map((c) => c.id)
		expect(blg20).toEqual(["demo-hex", "prod-hex", "ble-src", "9151-src", "adv-ble", "adv-full"])
		expect(chipsFor("blg20").find((c) => c.id === "9151-src")?.label).toContain("nRF9151")
		expect(blg20).not.toContain("esp-src")
		expect(blg20).not.toContain("9160-src")

		// The other family is untouched.
		expect(chipsFor("lew840x").map((c) => c.id)).toEqual(["ble-src", "esp-src", "9160-src"])

		// Every family in the picker resolves to a non-empty list — a family whose chips did not
		// resolve would render a form with nothing to tick and a Send button that never enables.
		for (const f of FAMILIES) {
			expect(chipsFor(f.id).length).toBeGreaterThan(0)
		}
		// And an unknown family falls back rather than throwing on [0].id.
		expect(chipsFor("nope").length).toBeGreaterThan(0)
	})
})
