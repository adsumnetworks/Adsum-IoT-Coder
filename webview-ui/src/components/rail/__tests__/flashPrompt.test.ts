import { describe, expect, it } from "vitest"
import { flashPrompt } from "../flashPrompt"

const blg20 = {
	title: "BLG20x demo pair",
	version: "1.0.0",
	licensee: "Acme Ltd",
	folder: "/ws/firmware/blg20x/1.0.0",
	family: "blg20x",
	files: [
		"LICENSE-ADSUM.txt",
		"bm20/merged.hex",
		"nrf9151/merged.hex",
		"usb/release.json",
		"usb/demo/ble.signed.bin",
		"usb/demo/lte.signed.bin",
	],
}

const lew840x = {
	title: "LEW840x demo",
	version: "1.0.0",
	licensee: "Acme Ltd",
	folder: "/ws/firmware/lew840x/1.0.0",
	family: "lew840x",
	files: [
		"LICENSE-ADSUM.txt",
		"ble/ble-scanner.hex",
		"ble/ble-scanner-lr.hex",
		"esp32/flasher_args.json",
		"esp32/lew840x_gateway.bin",
		"esp32/ota_data_initial.bin",
		"esp32/bootloader/bootloader.bin",
		"esp32/partition_table/partition-table.bin",
		"lte/lte-bearer-demo.hex",
	],
}

describe("flashPrompt: the ways onto the unit come from the folder's own files", () => {
	it("names what, for whom and from where, the receipt, and the ask before programming", () => {
		const p = flashPrompt(blg20)
		expect(p).toMatch(/^Flash BLG20x demo pair v1\.0\.0, licensed to Acme Ltd, from \/ws\/firmware\/blg20x\/1\.0\.0\./)
		expect(p).toContain("/ws/firmware/blg20x/1.0.0/adsum-firmware.json")
		expect(p).toContain("say the flash line first")
		expect(p).toMatch(/Ask me which way, and which probe or port is which, before you program anything\.$/)
	})

	it("a BLG20x folder offers both, each through the bit that carries its procedure", () => {
		const p = flashPrompt(blg20)
		expect(p).toContain(
			"(1) over its USB service port, an update, as `products/fanstel/blg20x/usb-service-port.md` lays it out",
		)
		expect(p).toContain("blg20-service update-check /ws/firmware/blg20x/1.0.0/usb")
		expect(p).toContain(
			"update-ble /ws/firmware/blg20x/1.0.0/usb/demo/ble.signed.bin` then `update-lte /ws/firmware/blg20x/1.0.0/usb/demo/lte.signed.bin",
		)
		expect(p).toContain(
			"(2) over the debug probes, a factory load that clears the settings, as `products/fanstel/blg20x/beats/s2-flash-the-demo.md`",
		)
		expect(p).toContain("/ws/firmware/blg20x/1.0.0/bm20/merged.hex")
		expect(p).toContain("/ws/firmware/blg20x/1.0.0/nrf9151/merged.hex")
	})

	it("a folder with only factory images offers only the probes", () => {
		const p = flashPrompt({ ...blg20, files: ["LICENSE-ADSUM.txt", "bm20/merged.hex", "nrf9151/merged.hex"] })
		expect(p).not.toContain("update-check")
		expect(p).toContain("The way onto the unit: over the debug probes")
	})

	it("a LEW840x is one way over three chips: its flash bit, the flash-cycle tool for the ESP32, one scanner chosen by the card", () => {
		const p = flashPrompt(lew840x)
		expect(p).toContain("The way onto the unit: as `products/fanstel/lew840x/gateway-flash.md` lays it out")
		expect(p).toContain("esp-flash-cycle --port <its port> --build /ws/firmware/lew840x/1.0.0/esp32")
		expect(p).toContain("never a hand-typed esptool write")
		expect(p).not.toContain("python -m esptool")
		expect(p).toContain(
			"ONE of `/ws/firmware/lew840x/1.0.0/ble/ble-scanner.hex` or `/ws/firmware/lew840x/1.0.0/ble/ble-scanner-lr.hex`",
		)
		expect(p).toContain("read the card first")
		expect(p).toContain("the cellular card's bearer, `/ws/firmware/lew840x/1.0.0/lte/lte-bearer-demo.hex`")
		expect(p).not.toContain("factory load")
		expect(p).not.toContain("update-check")
	})

	it("an LBG20x is never offered the cable: its USB-C carries power only, and its own route comes first", () => {
		const p = flashPrompt({
			...blg20,
			title: "LBG20x demo pair",
			folder: "/ws/firmware/lbg20x/1.0.0",
			family: "lbg20x",
			unitRoute:
				"to LBG20x AD50 over Bluetooth with `blg20-service update-pair --ble AD50 /ws/firmware/lbg20x/1.0.0/usb/demo --json`",
		})
		expect(p).toContain("(1) to LBG20x AD50 over Bluetooth")
		expect(p).not.toContain("USB service port")
		expect(p).toContain("(2) over the debug probes, a factory load that clears the settings")
	})

	it("an ended term is said, not hidden", () => {
		const p = flashPrompt({ ...blg20, expiredOn: "2027-10-09" })
		expect(p).toContain(
			"The licence term ended on 2027-10-09; the files still flash, and renewal is a request from the Hardware page.",
		)
	})

	it("a family with no bit of its own still gets the probes, without a claim about settings", () => {
		const p = flashPrompt({ ...blg20, family: "other", files: ["app.hex"] })
		expect(p).toContain(
			"The way onto the unit: over the debug probes: `/ws/firmware/blg20x/1.0.0/app.hex`, one image per chip with nrfutil.",
		)
		expect(p).not.toContain("clears the settings")
	})
})
