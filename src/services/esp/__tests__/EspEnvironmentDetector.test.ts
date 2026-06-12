import { describe, it } from "mocha"
import "should"
import {
	ESP_FAMILY_VIDS,
	filterEspPorts,
	parseIdfVersionFile,
	parseProjectDescription,
	type RawPortData,
} from "../EspEnvironmentDetector"

describe("EspEnvironmentDetector — pure helpers", () => {
	describe("parseIdfVersionFile", () => {
		it("parses 'v5.3.2' correctly", () => {
			parseIdfVersionFile("v5.3.2")!.should.equal("v5.3.2")
		})

		it("parses '5.3.2' (no leading v) and adds the v", () => {
			parseIdfVersionFile("5.3.2")!.should.equal("v5.3.2")
		})

		it("handles trailing newline", () => {
			parseIdfVersionFile("v5.2.1\n")!.should.equal("v5.2.1")
		})

		it("handles Windows CRLF", () => {
			parseIdfVersionFile("v5.1.0\r\n")!.should.equal("v5.1.0")
		})

		it("returns undefined for empty content", () => {
			should(parseIdfVersionFile("")).be.undefined()
		})

		it("returns undefined for non-version content", () => {
			should(parseIdfVersionFile("not-a-version")).be.undefined()
		})
	})

	describe("parseProjectDescription", () => {
		it("extracts idf_version from project_description.json", () => {
			const json = JSON.stringify({ idf_version: "v5.3.2", project_name: "my_app" })
			parseProjectDescription(json)!.should.equal("v5.3.2")
		})

		it("returns undefined when idf_version is missing", () => {
			should(parseProjectDescription(JSON.stringify({ project_name: "my_app" }))).be.undefined()
		})

		it("returns undefined for malformed JSON", () => {
			should(parseProjectDescription("{not valid json")).be.undefined()
		})

		it("returns undefined for empty string", () => {
			should(parseProjectDescription("")).be.undefined()
		})
	})

	describe("filterEspPorts", () => {
		const mkPort = (device: string, vid: number | null, pid?: number): RawPortData => ({
			device,
			vid,
			pid: pid ?? null,
			description: `Port ${device}`,
		})

		it("keeps Espressif native USB VID 0x303A", () => {
			const ports = filterEspPorts([mkPort("/dev/ttyACM0", 0x303a, 0x4001)])
			ports.should.have.length(1)
			ports[0].port.should.equal("/dev/ttyACM0")
			ports[0].vid!.should.equal(0x303a)
		})

		it("keeps CP210x VID 0x10C4", () => {
			filterEspPorts([mkPort("/dev/ttyUSB0", 0x10c4)]).should.have.length(1)
		})

		it("keeps CH340 VID 0x1A86", () => {
			filterEspPorts([mkPort("/dev/ttyUSB1", 0x1a86)]).should.have.length(1)
		})

		it("keeps FTDI VID 0x0403", () => {
			filterEspPorts([mkPort("COM3", 0x0403)]).should.have.length(1)
		})

		it("excludes SEGGER VID 0x1366 (nRF DK VCOM)", () => {
			filterEspPorts([mkPort("/dev/ttyACM0", 0x1366)]).should.have.length(0)
		})

		it("excludes ports with null VID", () => {
			filterEspPorts([mkPort("/dev/ttyS0", null)]).should.have.length(0)
		})

		it("excludes unknown VIDs", () => {
			filterEspPorts([mkPort("/dev/ttyUSB0", 0xabcd)]).should.have.length(0)
		})

		it("handles mixed list correctly", () => {
			const ports = filterEspPorts([
				mkPort("/dev/ttyACM0", 0x1366), // nRF DK — excluded
				mkPort("/dev/ttyUSB0", 0x10c4), // CP210x — included
				mkPort("/dev/ttyS0", null), // no VID — excluded
				mkPort("/dev/ttyACM1", 0x303a), // Espressif — included
			])
			ports.should.have.length(2)
			ports.map((p) => p.port).should.containEql("/dev/ttyUSB0")
			ports.map((p) => p.port).should.containEql("/dev/ttyACM1")
		})

		it("maps all four ESP_FAMILY_VIDS to included", () => {
			for (const vid of ESP_FAMILY_VIDS) {
				const result = filterEspPorts([mkPort("/dev/test", vid)])
				result.should.have.length(1)
			}
		})
	})
})
