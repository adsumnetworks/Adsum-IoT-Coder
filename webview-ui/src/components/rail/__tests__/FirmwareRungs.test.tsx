import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * [0.5 the firmware lane] One action per state, and the Download confirmation names what goes where. The
 * host call is stubbed at the service client so the rows are exactly what the host would send.
 */
const calls: Array<Record<string, unknown>> = []
let rowsToServe: unknown[] = []

vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: {
		firmware: async (req: { value: string }) => {
			const body = JSON.parse(req.value) as Record<string, unknown>
			calls.push(body)
			if (body.op === "list") {
				return { value: JSON.stringify({ ok: true, rows: rowsToServe }) }
			}
			return { value: JSON.stringify({ ok: true }) }
		},
	},
}))

import FirmwareRungs from "../FirmwareRungs"

const entry = (over: Record<string, unknown> = {}) => ({
	id: "adsum/firmware/blg20x-production",
	version: "2.3.0",
	family: "blg20x",
	variant: null,
	rung: "production",
	group: "blg20-prod-hex",
	title: "BLG20x production pair",
	summary: null,
	security: false,
	entitled: true,
	artifacts: [{ path: "nrf9151/zephyr.signed.hex", sha256: "ab", size: 10, group: null }],
	...over,
})
const local = (status: "active" | "expired" = "active") => ({
	folder: "/ws/firmware/blg20x/2.3.0",
	intact: true,
	receipt: {
		licensee: "Acme Ltd",
		term_end: "2027-10-10T00:00:00Z",
		status,
		downloaded_at: "2026-10-10T00:00:00Z",
		artifacts: [{ path: "bm20/merged.hex" }, { path: "usb/release.json" }, { path: "usb/demo/ble.signed.bin" }],
	},
})
const row = (state: string, l: ReturnType<typeof local> | null = null, e = entry()) => ({
	entry: e,
	local: l,
	state,
	folder: "/ws/firmware/blg20x/2.3.0",
})

describe("FirmwareRungs", () => {
	beforeEach(() => {
		calls.length = 0
		rowsToServe = []
	})

	it("says so when nothing is listed", async () => {
		render(<FirmwareRungs onAsk={() => {}} onFlash={() => {}} onRegister={() => {}} onRenew={() => {}} />)
		await screen.findByText(/No firmware versions are listed/)
	})

	it("download: one button, and the confirmation names the folder and the licence file before anything moves", async () => {
		rowsToServe = [row("download")]
		render(<FirmwareRungs onAsk={() => {}} onFlash={() => {}} onRegister={() => {}} onRenew={() => {}} />)
		const btn = await screen.findByRole("button", { name: /Download v2\.3\.0/ })
		expect(screen.queryByRole("button", { name: /Flash/ })).toBeNull()
		fireEvent.click(btn)
		// The folder as the developer sees it in the workspace, and the confirm replaces the button it opened from.
		expect(screen.getByText("firmware/blg20x/2.3.0")).toBeTruthy()
		expect(screen.getByText(/in this workspace, with its licence and a receipt beside/)).toBeTruthy()
		expect(screen.queryByRole("button", { name: /Download v2\.3\.0/ })).toBeNull()
		// Nothing was downloaded yet: the only host call so far is the list.
		expect(calls.map((c) => c.op)).toEqual(["list"])
		fireEvent.click(screen.getByRole("button", { name: "Download here" }))
		await waitFor(() => expect(calls.some((c) => c.op === "download")).toBe(true))
		const dl = calls.find((c) => c.op === "download")!
		expect(dl.pick).toBe(false)
		expect(dl.version).toBe("2.3.0")
	})

	it("flash: the prompt carries family, version, licensee and the folder, and Open folder stands beside it", async () => {
		rowsToServe = [row("flash", local())]
		const onFlash = vi.fn()
		render(<FirmwareRungs onAsk={() => {}} onFlash={onFlash} onRegister={() => {}} onRenew={() => {}} />)
		fireEvent.click(await screen.findByRole("button", { name: /Flash v2\.3\.0/ }))
		expect(onFlash).toHaveBeenCalledTimes(1)
		const prompt = onFlash.mock.calls[0][0] as string
		expect(prompt).toMatch(/BLG20x production pair v2\.3\.0/)
		expect(prompt).toMatch(/licensed to Acme Ltd/)
		expect(prompt).toMatch(/\/ws\/firmware\/blg20x\/2\.3\.0/)
		expect(screen.getByRole("button", { name: "Open folder" })).toBeTruthy()
		expect(screen.queryByRole("button", { name: /Download/ })).toBeNull()
	})

	it("renew and ask are states with one control each, never a wall", async () => {
		rowsToServe = [row("renew", local("expired")), row("ask", null, entry({ version: "2.4.0", entitled: false }))]
		const onRenew = vi.fn()
		const onAsk = vi.fn()
		render(<FirmwareRungs onAsk={onAsk} onFlash={() => {}} onRegister={() => {}} onRenew={onRenew} />)
		fireEvent.click(await screen.findByRole("button", { name: "Ask to renew" }))
		fireEvent.click(screen.getByRole("button", { name: "Ask for more details" }))
		expect(onRenew).toHaveBeenCalledTimes(1)
		expect(onAsk).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole("button", { name: /Download/ })).toBeNull()
	})

	it("the Flash prompt names the ways the folder's own files allow", async () => {
		rowsToServe = [row("flash", local())]
		const onFlash = vi.fn()
		render(<FirmwareRungs onAsk={() => {}} onFlash={onFlash} onRegister={() => {}} onRenew={() => {}} />)
		fireEvent.click(await screen.findByRole("button", { name: /Flash v2\.3\.0/ }))
		const prompt = onFlash.mock.calls[0][0] as string
		expect(prompt).toContain("blg20-service update-check /ws/firmware/blg20x/2.3.0/usb")
		expect(prompt).toContain("/ws/firmware/blg20x/2.3.0/bm20/merged.hex")
	})

	it("no account: one Register button, never Ask or Download", async () => {
		rowsToServe = [row("register")]
		const onRegister = vi.fn()
		render(<FirmwareRungs onAsk={() => {}} onFlash={() => {}} onRegister={onRegister} onRenew={() => {}} />)
		fireEvent.click(await screen.findByRole("button", { name: "Register, free" }))
		expect(onRegister).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole("button", { name: /Download|Ask for more details/ })).toBeNull()
	})

	it("a Bluetooth route the unit supplies comes first in the prompt", async () => {
		rowsToServe = [row("flash", local())]
		const onFlash = vi.fn()
		render(
			<FirmwareRungs
				onAsk={() => {}}
				onFlash={onFlash}
				onRegister={() => {}}
				onRenew={() => {}}
				unitRoute="over Bluetooth to LBG20x AD50"
			/>,
		)
		fireEvent.click(await screen.findByRole("button", { name: /Flash v2\.3\.0/ }))
		expect(onFlash.mock.calls[0][0]).toContain("(1) over Bluetooth to LBG20x AD50")
	})

	it("one focal action per view: the first row that can act is filled, the next is quiet; an altered folder says Download again", async () => {
		rowsToServe = [
			row("renew", null, entry({ version: "3.0.0", entitled: false })),
			row("download", local()),
			row("download", null, entry({ version: "2.2.0" })),
		]
		render(<FirmwareRungs onAsk={() => {}} onFlash={() => {}} onRegister={() => {}} onRenew={() => {}} />)
		const again = await screen.findByRole("button", { name: "Download again" })
		expect(again.getAttribute("data-focal")).toBe("yes")
		expect(screen.getByRole("button", { name: /Download v2\.2\.0/ }).getAttribute("data-focal")).toBeNull()
		expect(screen.getByRole("button", { name: "Ask to renew" }).getAttribute("data-focal")).toBeNull()
	})
})
