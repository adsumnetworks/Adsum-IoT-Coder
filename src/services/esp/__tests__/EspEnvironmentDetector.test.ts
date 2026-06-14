import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { afterEach, describe, it } from "mocha"
import { tmpdir } from "os"
import { join } from "path"
import "should"
import {
	ESP_FAMILY_VIDS,
	filterEspPorts,
	parseDependenciesLockIdfVersion,
	parseIdfVersionFile,
	parseProjectDescription,
	type RawPortData,
	readEspBuildInfo,
	readProjectIdfVersionFromLock,
} from "../EspEnvironmentDetector"

// Real dependencies.lock shape (from Omar's mqtt-tcp-idf552 / mqtt-test). The
// resolved IDF version lives under the top-level `idf:` dependency.
const DEP_LOCK = `dependencies:
  espressif/mdns:
    component_hash: abc123
    source:
      registry_url: https://components.espressif.com/
      type: service
    version: 1.7.19~2
  idf:
    source:
      type: idf
    version: 5.5.2
direct_dependencies:
- espressif/mdns
- idf
manifest_hash: deadbeef
target: esp32s3
version: 2.0.0
`

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

	describe("parseDependenciesLockIdfVersion", () => {
		it("extracts the idf version from a real dependencies.lock", () => {
			parseDependenciesLockIdfVersion(DEP_LOCK)!.should.equal("5.5.2")
		})

		it("returns the idf block's version, NOT another dependency's or the file version", () => {
			const v = parseDependenciesLockIdfVersion(DEP_LOCK)
			v!.should.equal("5.5.2")
			v!.should.not.equal("1.7.19~2") // espressif/mdns
			v!.should.not.equal("2.0.0") // the lock file's own version field
		})

		it("handles a quoted version value", () => {
			const lock = "dependencies:\n  idf:\n    source:\n      type: idf\n    version: '6.0.0'\n"
			parseDependenciesLockIdfVersion(lock)!.should.equal("6.0.0")
		})

		it("handles CRLF line endings", () => {
			parseDependenciesLockIdfVersion(DEP_LOCK.replace(/\n/g, "\r\n"))!.should.equal("5.5.2")
		})

		it("is not fooled by 'type: idf' or 'if: idf_version >=6.0' lines", () => {
			const lock =
				"dependencies:\n  foo:\n    source:\n      type: idf\n    rules:\n    - if: idf_version >=6.0\n    version: 9.9.9\n"
			should(parseDependenciesLockIdfVersion(lock)).be.undefined()
		})

		it("returns undefined when there is no idf dependency", () => {
			should(parseDependenciesLockIdfVersion("dependencies:\n  espressif/mdns:\n    version: 1.0.0\n")).be.undefined()
		})

		it("returns undefined for empty content", () => {
			should(parseDependenciesLockIdfVersion("")).be.undefined()
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

	// Recognizes a build by its FILE under any build-dir name — the fix for a
	// custom build dir (idf.py -B / the VS Code extension's idf.buildPath) being
	// missed when the code assumed a folder literally named "build/".
	describe("readEspBuildInfo (real temp dirs)", () => {
		const tmps: string[] = []
		const mkRoot = (): string => {
			const dir = mkdtempSync(join(tmpdir(), "esp-build-test-"))
			tmps.push(dir)
			return dir
		}
		const writeBuild = (root: string, buildDirName: string, descriptor: object | string) => {
			const buildDir = join(root, buildDirName)
			mkdirSync(buildDir, { recursive: true })
			const content = typeof descriptor === "string" ? descriptor : JSON.stringify(descriptor)
			writeFileSync(join(buildDir, "project_description.json"), content)
		}
		afterEach(() => {
			while (tmps.length) {
				rmSync(tmps.pop()!, { recursive: true, force: true })
			}
		})

		it("recognizes a build in a CUSTOM-named dir and reads idf_version", () => {
			const root = mkRoot()
			writeBuild(root, "cmake-build-debug", { idf_version: "v5.3.2", target: "esp32s3" })
			const info = readEspBuildInfo([root])
			info.built.should.be.true()
			info.idfVersion!.should.equal("v5.3.2")
		})

		it("recognizes a build in a dir literally named 'build'", () => {
			const root = mkRoot()
			writeBuild(root, "build", { idf_version: "v5.1.0" })
			readEspBuildInfo([root]).idfVersion!.should.equal("v5.1.0")
		})

		it("recognizes a build even when the descriptor has no idf_version (built ≠ version)", () => {
			const root = mkRoot()
			writeBuild(root, "build_esp32c6", { target: "esp32c6" })
			const info = readEspBuildInfo([root])
			info.built.should.be.true()
			should(info.idfVersion).be.undefined()
		})

		it("treats a malformed descriptor as a build (file exists)", () => {
			const root = mkRoot()
			writeBuild(root, "out", "{not valid json")
			const info = readEspBuildInfo([root])
			info.built.should.be.true()
			should(info.idfVersion).be.undefined()
		})

		it("returns built=false when no project_description.json exists", () => {
			const root = mkRoot()
			mkdirSync(join(root, "src"), { recursive: true })
			readEspBuildInfo([root]).built.should.be.false()
		})

		it("scans multiple roots and finds the built one", () => {
			const empty = mkRoot()
			const built = mkRoot()
			writeBuild(built, "build-c3", { idf_version: "v5.2.1" })
			readEspBuildInfo([empty, built]).idfVersion!.should.equal("v5.2.1")
		})

		it("readProjectIdfVersionFromLock reads dependencies.lock at the root", () => {
			const root = mkRoot()
			writeFileSync(join(root, "dependencies.lock"), DEP_LOCK)
			readProjectIdfVersionFromLock([root])!.should.equal("5.5.2")
		})

		it("readProjectIdfVersionFromLock finds a lock in a nested app folder", () => {
			const root = mkRoot()
			const app = join(root, "esp-app")
			mkdirSync(app, { recursive: true })
			writeFileSync(join(app, "dependencies.lock"), DEP_LOCK)
			readProjectIdfVersionFromLock([root])!.should.equal("5.5.2")
		})

		it("readProjectIdfVersionFromLock returns undefined when there is no lock", () => {
			const root = mkRoot()
			mkdirSync(join(root, "main"), { recursive: true })
			should(readProjectIdfVersionFromLock([root])).be.undefined()
		})
	})
})
