import { espUnresolvedDeviceLabel } from "@shared/esp"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import EnvStrip from "../EnvStrip"

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: vi.fn() }))
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { refreshNrfEnvironment: vi.fn(() => Promise.resolve()) },
}))

const NRF_READY = {
	status: "ready",
	extensionPresent: true,
	nrfutilPresent: true,
	boards: [{ deviceName: "nRF5340 DK", boardVersion: "PCA10095", serialNumber: "1" }],
}
const ESP_ABSENT = { status: "ready", extensionPresent: false, idfPresent: false, projectDetected: false, espDevices: [] }

const mockState = (over: Record<string, unknown> = {}) =>
	vi.mocked(useExtensionState).mockReturnValue({
		openFolderPaths: [],
		nrfEnvironment: NRF_READY,
		espEnvironment: ESP_ABSENT,
		...over,
	} as any)

describe("EnvStrip — compact / expand (A5)", () => {
	beforeEach(() => {
		vi.mocked(useExtensionState).mockReset()
	})

	it("collapsed by default: shows the compact summary, not the full detail", () => {
		mockState()
		render(<EnvStrip />)
		const summary = screen.getByTestId("envstrip-summary")
		expect(summary).toBeInTheDocument()
		expect(screen.queryByTestId("envstrip-collapse")).not.toBeInTheDocument()
		expect(summary.textContent).toContain("nRF")
		expect(summary.textContent).toContain("nRF5340 DK")
	})

	it("click → expands to the full per-platform detail (collapse link appears)", () => {
		mockState()
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary"))
		expect(screen.getByTestId("envstrip-collapse")).toBeInTheDocument()
		expect(screen.queryByTestId("envstrip-summary")).not.toBeInTheDocument()
	})

	it("nothing detected → compact shows a setup hint (not platform rows)", () => {
		mockState({
			nrfEnvironment: { status: "ready", extensionPresent: false, nrfutilPresent: false, boards: [] },
			espEnvironment: ESP_ABSENT,
		})
		render(<EnvStrip />)
		expect(screen.getByTestId("envstrip-summary").textContent).toMatch(/No SDK detected/)
	})

	// Parity / honesty (2906i): an unconfirmed serial device must NOT be claimed as "ESP32-family". The exact
	// chip shows only once esptool resolves it; otherwise an honest label keyed on the USB VID.
	it("ESP device labels: resolved chip shown exactly; unresolved is honest (ESP-VID vs generic bridge)", () => {
		mockState({
			espEnvironment: {
				status: "ready",
				extensionPresent: true,
				idfPresent: true,
				projectDetected: true,
				espDevices: [
					{ port: "/dev/cu.a", vid: 0x303a, chip: "ESP32-S3", chipRevision: "v0.2" }, // resolved
					{ port: "/dev/cu.b", vid: 0x303a }, // Espressif's own VID, unresolved → it IS an ESP
					{ port: "/dev/cu.c", vid: 0x1a86 }, // generic CH34x, unresolved → no proof it's an ESP
				],
			},
		})
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary")) // expand to the per-platform detail
		const text = document.getElementById("envstrip-detail")?.textContent ?? ""
		expect(text).toContain("ESP32-S3 (v0.2)")
		expect(text).toContain("ESP (model unknown)")
		expect(text).toContain("unidentified serial device")
		expect(text).not.toContain("ESP32-family")
	})

	it("espUnresolvedDeviceLabel: Espressif VID → 'ESP (model unknown)', everything else → 'unidentified serial device'", () => {
		expect(espUnresolvedDeviceLabel(0x303a)).toBe("ESP (model unknown)")
		expect(espUnresolvedDeviceLabel(0x1a86)).toBe("unidentified serial device") // CH34x
		expect(espUnresolvedDeviceLabel(0x10c4)).toBe("unidentified serial device") // CP210x
		expect(espUnresolvedDeviceLabel(undefined)).toBe("unidentified serial device")
	})

	// A bench with four DKs attached rendered "nRF9161 DK, nRF5340 DK, PCA10184, nRF52840 DK" — one
	// board showing a raw code because PCA_NAMES stopped at the boards that existed when it was written.
	// Codes verified against the NCS board definitions, not from memory; that also caught PCA10100,
	// which was mapped to "nRF5340 DK" and is the nRF52833 DK.
	it("names every Nordic DK the bench reports — no raw PCA codes leak to the strip", () => {
		const expected: Record<string, string> = {
			PCA10056: "nRF52840 DK",
			PCA10095: "nRF5340 DK",
			PCA10100: "nRF52833 DK", // was wrong: mapped to nRF5340 DK
			PCA10153: "nRF9161 DK",
			PCA10156: "nRF54L15 DK",
			PCA10171: "nRF9151 DK",
			PCA10184: "nRF54LM20 DK", // the one the bench surfaced
		}
		mockState({
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				// deviceName deliberately ABSENT — that is the real case. The strip renders
				// `deviceName ?? PCA_NAMES[boardVersion] ?? …`, so the map is the fallback that was
				// leaking raw codes. With a deviceName present the map is never consulted at all.
				boards: Object.keys(expected).map((boardVersion, i) => ({
					boardVersion,
					serialNumber: String(i),
				})),
			},
		})
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary"))
		for (const [code, name] of Object.entries(expected)) {
			expect(screen.queryByText(new RegExp(code))).toBeNull() // the raw code must never render
			expect(screen.getByText(new RegExp(name))).toBeInTheDocument()
		}
	})

	// The bench runs two nRF9161 DKs. Both report PCA10153, so both render as "nRF9161 DK" and the
	// developer cannot tell from the strip which board a command will reach.
	it("two boards of the same kind are disambiguated by the tail of the serial", () => {
		mockState({
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				// No deviceName — same as the real nrfutil payload, so PCA_NAMES is what names them.
				boards: [
					{ boardVersion: "PCA10153", serialNumber: "001050992288" },
					{ boardVersion: "PCA10153", serialNumber: "001050924638" },
				],
			},
		})
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary"))
		expect(screen.getByText(/nRF9161 DK ·2288/)).toBeInTheDocument()
		expect(screen.getByText(/nRF9161 DK ·4638/)).toBeInTheDocument()
	})

	// …but the suffix is only worth its noise where it resolves an ambiguity. The overwhelmingly common
	// case is one board of each kind, and those must stay clean.
	it("distinct boards carry no serial suffix", () => {
		mockState({
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				boards: [
					{ boardVersion: "PCA10153", serialNumber: "001050992288" },
					{ boardVersion: "PCA10056", serialNumber: "001050256273" },
				],
			},
		})
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary"))
		expect(screen.getByText(/nRF9161 DK/)).toBeInTheDocument()
		expect(screen.getByText(/nRF52840 DK/)).toBeInTheDocument()
		expect(screen.queryByText(/·2288/)).toBeNull()
		expect(screen.queryByText(/·6273/)).toBeNull()
	})

	// a11y: the EnvStrip is a disclosure widget — its toggle must announce its state + control region to AT.
	it("disclosure a11y: toggle has aria-expanded (false→true), aria-label, aria-controls → the region id", () => {
		mockState()
		render(<EnvStrip />)
		const summary = screen.getByTestId("envstrip-summary")
		expect(summary).toHaveAttribute("aria-expanded", "false")
		expect(summary).toHaveAttribute("aria-label", "Show environment detail")
		expect(summary).toHaveAttribute("aria-controls", "envstrip-detail")
		fireEvent.click(summary)
		const collapse = screen.getByTestId("envstrip-collapse")
		expect(collapse).toHaveAttribute("aria-expanded", "true")
		expect(collapse).toHaveAttribute("aria-label", "Hide environment detail")
		expect(document.getElementById("envstrip-detail")).toBeInTheDocument()
	})
})
