import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import GatePanel from "../GatePanel"

/**
 * S-01…S-05 — the waiting view and its paste field.
 *
 * The browser's vscode:// link can open another window or another editor. The window that started sign-in
 * finishes by itself; when it cannot, the developer pastes the link from the browser page into the field in
 * plain sight — no hidden link, no input box.
 */

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const rpc = vi.hoisted(() => ({ startSignIn: vi.fn(), pasteSignInLink: vi.fn(), refreshAccount: vi.fn() }))

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: {
		startSignIn: (...a: unknown[]) => rpc.startSignIn(...a),
		pasteSignInLink: (...a: unknown[]) => rpc.pasteSignInLink(...a),
		refreshAccount: (...a: unknown[]) => rpc.refreshAccount(...a) ?? Promise.resolve({}),
	},
}))

const LINK =
	"vscode://AdsumNetwork.nrf-ai-debugger/auth/callback?code=Zk3q9xYw2Lr8Tn5Vb1Hc7Pd4Sf6Ga0Je&state=Qm2Wn8Er4Ty6Ui0Op3As5Df7Gh9Jk1Lz"
const answer = (ok: boolean, message: string) => Promise.resolve({ value: JSON.stringify({ ok, message }) })
const paste = (el: HTMLElement, text: string) => fireEvent.paste(el, { clipboardData: { getData: () => text } })

beforeEach(() => {
	state.current = {}
	rpc.startSignIn.mockReset().mockReturnValue(Promise.resolve({ value: "" }))
	rpc.pasteSignInLink.mockReset().mockReturnValue(answer(true, "You're signed in."))
})

describe("S — waiting for the browser, with the paste field in plain sight", () => {
	it("S-01 the field renders only while a sign-in is waiting", async () => {
		render(<GatePanel onClose={vi.fn()} open={true} />)
		expect(screen.queryByTestId("signin-link-field")).toBeNull()
		expect(screen.getByTestId("signin-link-disclose").textContent).toBe("Paste it")
		await act(async () => {
			fireEvent.click(screen.getByTestId("gate-provider-github"))
		})
		expect(screen.getByText("Finish signing in in your browser — this window will sign in on its own.")).toBeTruthy()
		expect(screen.queryByTestId("gate-provider-github")).toBeNull()
		expect(screen.queryByTestId("signin-link-disclose")).toBeNull()
		expect(screen.getByTestId("signin-link-field")).toBeTruthy()
		expect(screen.getByTestId("signin-link-submit").textContent).toBe("Sign in")
	})

	it("S-02 the waiting view comes from the host's pending sign-in, so it survives closing and reopening", () => {
		state.current = { adsumSignInPending: true }
		render(<GatePanel onClose={vi.fn()} open={true} />)
		expect(screen.getByTestId("signin-link-field")).toBeTruthy()
	})

	it("S-02b before Continue, one quiet line opens the same field", async () => {
		render(<GatePanel onClose={vi.fn()} open={true} />)
		expect(screen.getByText(/Have a sign-in link\?/)).toBeTruthy()
		fireEvent.click(screen.getByTestId("signin-link-disclose"))
		const field = screen.getByTestId("signin-link-field")
		await act(async () => {
			paste(field, LINK)
		})
		expect(rpc.pasteSignInLink).toHaveBeenCalledTimes(1)
	})

	it("S-03 pasting a sign-in link submits once, with no click", async () => {
		state.current = { adsumSignInPending: true }
		render(<GatePanel onClose={vi.fn()} open={true} />)
		const field = screen.getByTestId("signin-link-field")
		await act(async () => {
			paste(field, LINK)
			paste(field, LINK)
		})
		expect(rpc.pasteSignInLink).toHaveBeenCalledTimes(1)
		expect(rpc.pasteSignInLink.mock.calls[0][0]).toEqual(expect.objectContaining({ value: LINK }))
	})

	it("S-04 pasting something else does not submit; the button does, and says it is not a link", async () => {
		state.current = { adsumSignInPending: true }
		render(<GatePanel onClose={vi.fn()} open={true} />)
		const field = screen.getByTestId("signin-link-field")
		await act(async () => {
			paste(field, "hello")
			fireEvent.change(field, { target: { value: "hello" } })
		})
		expect(rpc.pasteSignInLink).not.toHaveBeenCalled()
		await act(async () => {
			fireEvent.click(screen.getByTestId("signin-link-submit"))
		})
		expect(screen.getByTestId("signin-link-error").textContent).toMatch(/^That doesn't look like a sign-in link/)
		expect(rpc.pasteSignInLink).not.toHaveBeenCalled()
	})

	it("S-05 another window's link and an expired link each show their refusal under the field", async () => {
		state.current = { adsumSignInPending: true }
		for (const message of [
			"This link belongs to a sign-in started in another window. Press Sign in here and use the new link.",
			"This sign-in link has expired or was already used. Press Sign in here and use the new link.",
		]) {
			rpc.pasteSignInLink.mockReturnValueOnce(answer(false, message))
			const { unmount } = render(<GatePanel onClose={vi.fn()} open={true} />)
			await act(async () => {
				paste(screen.getByTestId("signin-link-field"), LINK)
			})
			expect(screen.getByTestId("signin-link-error").textContent).toBe(message)
			unmount()
		}
	})
})
