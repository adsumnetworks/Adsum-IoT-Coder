import { describeSerialBridge, espUnresolvedDeviceLabel } from "@shared/esp"
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
					{ port: "/dev/cu.c", vid: 0x1a86, pid: 0x7523 }, // generic CH340, unresolved → no proof it's an ESP
					{ port: "/dev/cu.d", vid: 0x2e8a }, // a VID we do not know at all
				],
			},
		})
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary")) // expand to the per-platform detail
		const text = document.getElementById("envstrip-detail")?.textContent ?? ""
		expect(text).toContain("ESP32-S3 (v0.2)")
		expect(text).toContain("ESP (model unknown)")
		// The bridge is named — the CABLE, which the USB ids DO prove — and nothing beyond it.
		expect(text).toContain("CH340 USB-UART bridge")
		// A VID we cannot name keeps the old wording. Losing that would mean the label had started guessing.
		expect(text).toContain("unidentified serial device")
		expect(text).not.toContain("ESP32-family")
	})

	it("espUnresolvedDeviceLabel: Espressif VID is an ESP, a known bridge is named, anything else stays unnamed", () => {
		expect(espUnresolvedDeviceLabel(0x303a)).toBe("ESP (model unknown)")
		// MEASURED on the operator's LEW840x with the Fanstel IOT-UART-ESP32-V1 bridge card, 6 Sep:
		// idVendor 0x10C4, idProduct 0xEA60, "CP2102 USB to UART Bridge Controller", serial "0001".
		expect(espUnresolvedDeviceLabel(0x10c4, 0xea60)).toBe("CP2102 USB-UART bridge")
		expect(espUnresolvedDeviceLabel(0x1a86, 0x7523)).toBe("CH340 USB-UART bridge")
		expect(espUnresolvedDeviceLabel(0x0403)).toBe("FTDI USB-UART bridge")
		// The canary: a VID we do not recognise must NOT acquire a name.
		expect(espUnresolvedDeviceLabel(0x2e8a)).toBe("unidentified serial device")
		expect(espUnresolvedDeviceLabel(undefined)).toBe("unidentified serial device")
	})

	it("describeSerialBridge names the CABLE and never the board", () => {
		expect(describeSerialBridge(0x10c4, 0xea60)).toBe("CP2102 USB-UART bridge")
		expect(describeSerialBridge(0x1a86, 0x55d4)).toBe("CH9102 USB-UART bridge")
		expect(describeSerialBridge(0x0403, 0x6001)).toBe("FTDI USB-UART bridge")
		expect(describeSerialBridge(0x2e8a, 0x0005)).toBeUndefined()
		expect(describeSerialBridge(undefined)).toBeUndefined()
		// The plan assumed Fanstel's IOT-UART-ESP32-V1 was nameable from USB alone. It is not: the board
		// presents Silicon Labs' stock 0x10C4/0xEA60 with the default serial "0001" and nothing else, so
		// naming it here would put a guess on every CP2102 in the world. This case is what stops that.
		// Ruled on by the operator, 7 Sep: the bridge name alone. "(PK-BWG840)" — Fanstel's name for the
		// programming kit this card is sold as — would land on every DevKit, NodeMCU and Arduino clone
		// carrying the same chip.
		for (const [vid, pid] of [
			[0x10c4, 0xea60],
			[0x1a86, 0x7523],
			[0x0403, 0x6001],
		] as const) {
			expect(describeSerialBridge(vid, pid)).not.toMatch(/fanstel|lew840|iot-uart|pk-bwg/i)
		}
	})

	// A bench with four DKs attached once rendered "nRF9161 DK, nRF5340 DK, PCA10184, nRF52840 DK": the
	// webview held its own PCA table and it stopped at the boards that existed when it was written. The
	// table now lives in the board-identity bit and the HOST resolves `boardName`; the strip renders
	// that and never a second copy. (dataBits.node-test.ts holds the rows and the two codes that were
	// once wrong — PCA10100, PCA10112 — next to the bit itself.)
	it("renders the host-resolved boardName and never the raw code beside it", () => {
		const boards = [
			{ boardVersion: "PCA10153", boardName: "nRF9161 DK", serialNumber: "0" },
			{ boardVersion: "PCA10184", boardName: "nRF54LM20 DK", serialNumber: "1" }, // the one the bench surfaced
			{ boardVersion: "PCA10201", boardName: "nRF9151 SMA DK", serialNumber: "2" }, // the operator's own kit
		]
		mockState({ nrfEnvironment: { status: "ready", extensionPresent: true, nrfutilPresent: true, boards } })
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary"))
		for (const b of boards) {
			expect(screen.queryByText(new RegExp(b.boardVersion))).toBeNull()
			expect(screen.getByText(new RegExp(b.boardName))).toBeInTheDocument()
		}
	})

	// …and when the host could not name it, the code shows — honestly, not as a blank.
	it("falls back to the raw PCA when the host resolved no name", () => {
		mockState({
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				boards: [{ boardVersion: "PCA99999", serialNumber: "0" }],
			},
		})
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary"))
		expect(screen.getByText(/PCA99999/)).toBeInTheDocument()
	})

	// The bench runs two nRF9161 DKs. Both report PCA10153, so both render as "nRF9161 DK" and the
	// developer cannot tell from the strip which board a command will reach.
	it("two boards of the same kind are disambiguated by the tail of the serial", () => {
		mockState({
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				// No deviceName — same as the real nrfutil payload; boardName is what the host resolved.
				boards: [
					{ boardVersion: "PCA10153", boardName: "nRF9161 DK", serialNumber: "001050992288" },
					{ boardVersion: "PCA10153", boardName: "nRF9161 DK", serialNumber: "001050924638" },
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
					{ boardVersion: "PCA10153", boardName: "nRF9161 DK", serialNumber: "001050992288" },
					{ boardVersion: "PCA10056", boardName: "nRF52840 DK", serialNumber: "001050256273" },
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
