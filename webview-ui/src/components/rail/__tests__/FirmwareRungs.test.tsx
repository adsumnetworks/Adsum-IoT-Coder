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
	receipt: { licensee: "Acme Ltd", term_end: "2027-10-10T00:00:00Z", status, downloaded_at: "2026-10-10T00:00:00Z" },
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
		render(<FirmwareRungs onAsk={() => {}} onFlash={() => {}} onRenew={() => {}} />)
		await screen.findByText(/No firmware versions are listed/)
	})

	it("download: one button, and the confirmation names the folder and the licence file before anything moves", async () => {
		rowsToServe = [row("download")]
		render(<FirmwareRungs onAsk={() => {}} onFlash={() => {}} onRenew={() => {}} />)
		const btn = await screen.findByRole("button", { name: /Download v2\.3\.0/ })
		expect(screen.queryByRole("button", { name: /Flash/ })).toBeNull()
		fireEvent.click(btn)
		expect(screen.getByText(/\/ws\/firmware\/blg20x\/2\.3\.0/)).toBeTruthy()
		expect(screen.getByText(/licence file and a receipt/)).toBeTruthy()
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
		render(<FirmwareRungs onAsk={() => {}} onFlash={onFlash} onRenew={() => {}} />)
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
		render(<FirmwareRungs onAsk={onAsk} onFlash={() => {}} onRenew={onRenew} />)
		fireEvent.click(await screen.findByRole("button", { name: "Renew in the browser" }))
		fireEvent.click(screen.getByRole("button", { name: "Ask for more details" }))
		expect(onRenew).toHaveBeenCalledTimes(1)
		expect(onAsk).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole("button", { name: /Download/ })).toBeNull()
	})
})
