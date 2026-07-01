import { describe, it } from "mocha"
import "should"
import { join } from "path"
import { type IdfPythonDeps, idfToolsPath, parseEsptoolChip, parseEsptoolMac, resolveIdfPython } from "../espChipProbe"

describe("espChipProbe — parseEsptoolChip", () => {
	it("parses 'Chip is ESP32-S3 (revision v0.2)'", () => {
		const r = parseEsptoolChip("Connecting....\nChip is ESP32-S3 (revision v0.2)\nFeatures: WiFi, BLE")
		r.chip!.should.equal("ESP32-S3")
		r.chipRevision!.should.equal("v0.2")
	})

	it("parses 'Chip is ESP32-C6 (revision v0.0)'", () => {
		parseEsptoolChip("Chip is ESP32-C6 (revision v0.0)").chip!.should.equal("ESP32-C6")
	})

	it("parses classic 'Chip is ESP32 (revision 3)'", () => {
		const r = parseEsptoolChip("Chip is ESP32 (revision 3)")
		r.chip!.should.equal("ESP32")
		r.chipRevision!.should.equal("3")
	})

	it("parses 'Chip is ESP32-S3' with no revision", () => {
		const r = parseEsptoolChip("Chip is ESP32-S3")
		r.chip!.should.equal("ESP32-S3")
		;(r.chipRevision === undefined).should.be.true()
	})

	it("falls back to 'Detecting chip type... ESP32-C3'", () => {
		parseEsptoolChip("Serial port /dev/ttyACM0\nDetecting chip type... ESP32-C3\n").chip!.should.equal("ESP32-C3")
	})

	it("returns empty for unrelated output", () => {
		const r = parseEsptoolChip("A fatal error occurred: Failed to connect")
		;(r.chip === undefined).should.be.true()
	})

	it("also surfaces the base MAC alongside the chip", () => {
		const r = parseEsptoolChip("Chip is ESP32-C6 (revision v0.1)\nMAC: ac:eb:e6:ff:fe:0c:f8:c0\nBASE MAC: ac:eb:e6:0c:f8:c0")
		r.chip!.should.equal("ESP32-C6")
		r.mac!.should.equal("ac:eb:e6:0c:f8:c0")
	})
})

describe("espChipProbe — parseEsptoolMac", () => {
	it("prefers the 6-octet BASE MAC over the 8-octet EUI-64 MAC line", () => {
		const out = "MAC: ac:eb:e6:ff:fe:0c:f8:c0\nBASE MAC: ac:eb:e6:0c:f8:c0"
		parseEsptoolMac(out)!.should.equal("ac:eb:e6:0c:f8:c0")
	})

	it("falls back to a 6-octet 'MAC:' line (ESP32 classic, no BASE MAC) and never grabs 6/8 of an EUI-64", () => {
		parseEsptoolMac("MAC: 24:6f:28:01:02:03")!.should.equal("24:6f:28:01:02:03")
		// an 8-octet EUI-64 with no BASE MAC must NOT be truncated to a bogus 6-octet base
		;(parseEsptoolMac("MAC: ac:eb:e6:ff:fe:0c:f8:c0") === undefined).should.be.true()
	})

	it("returns undefined when no MAC is present", () => {
		;(parseEsptoolMac("Chip is ESP32-S3\nFeatures: WiFi") === undefined).should.be.true()
	})
})

describe("espChipProbe — idfToolsPath", () => {
	it("uses IDF_TOOLS_PATH when set", () => {
		idfToolsPath({ platform: "linux", env: { IDF_TOOLS_PATH: "/opt/esp/tools" }, home: "/home/dev" }).should.equal(
			"/opt/esp/tools",
		)
	})

	it("defaults to ~/.espressif on Linux/macOS", () => {
		idfToolsPath({ platform: "linux", env: {}, home: "/home/dev" }).should.equal(join("/home/dev", ".espressif"))
		idfToolsPath({ platform: "darwin", env: {}, home: "/Users/dev" }).should.equal(join("/Users/dev", ".espressif"))
	})

	it("defaults to %USERPROFILE%\\.espressif on Windows", () => {
		idfToolsPath({ platform: "win32", env: { USERPROFILE: "C:\\Users\\dev" }, home: "C:\\Users\\dev" }).should.equal(
			join("C:\\Users\\dev", ".espressif"),
		)
	})
})

describe("espChipProbe — resolveIdfPython", () => {
	const make = (
		platform: IdfPythonDeps["platform"],
		present: string[],
		dirs: Record<string, string[]>,
		extra?: Partial<IdfPythonDeps>,
	): IdfPythonDeps => ({
		platform,
		env: {},
		home: platform === "win32" ? "C:\\Users\\dev" : "/home/dev",
		exists: (p) => present.includes(p),
		listDir: (p) => dirs[p] ?? [],
		...extra,
	})

	it("finds bin/python on Linux", () => {
		const root = join("/home/dev", ".espressif", "python_env")
		const py = join(root, "idf5.3_py3.11_env", "bin", "python")
		const deps = make("linux", [root, py], { [root]: ["idf5.3_py3.11_env"] })
		resolveIdfPython(deps)!.should.equal(py)
	})

	it("finds the EIM venv tools/python/<ver>/venv/bin/python when there is NO python_env (the macOS EIM gap)", () => {
		// EIM (the new official installer) does not create python_env; the venv lives at
		// ~/.espressif/tools/python/v6.0.1/venv/bin/python (verified on the real macOS install).
		const eimRoot = join("/home/dev", ".espressif", "tools", "python")
		const py = join(eimRoot, "v6.0.1", "venv", "bin", "python")
		const deps = make("darwin", [eimRoot, py], { [eimRoot]: ["v6.0.1"] })
		resolveIdfPython(deps)!.should.equal(py)
	})

	it("finds Scripts/python.exe on Windows via %USERPROFILE%\\.espressif", () => {
		const root = join("C:\\Users\\dev", ".espressif", "python_env")
		const py = join(root, "idf5.3_py3.11_env", "Scripts", "python.exe")
		const deps = make("win32", [root, py], { [root]: ["idf5.3_py3.11_env"] })
		resolveIdfPython(deps)!.should.equal(py)
	})

	it("finds python on Windows via C:\\Espressif when %USERPROFILE%\\.espressif is absent", () => {
		// Simulates the Espressif GUI installer layout: tools at C:\Espressif, not ~/.espressif
		const root = join("C:\\", "Espressif", "python_env")
		const py = join(root, "idf5.5_py3.14_env", "Scripts", "python.exe")
		const deps = make("win32", [root, py], { [root]: ["idf5.5_py3.14_env"] })
		resolveIdfPython(deps)!.should.equal(py)
	})

	it("finds C:\\Espressif python even when a toolsPathHint pointing nowhere is set", () => {
		// Espressif extension may set idf.toolsPathWin to %USERPROFILE%\.espressif by default
		// (its own default), but the actual tools are at C:\Espressif. The hint must not block
		// the fallback search.
		const root = join("C:\\", "Espressif", "python_env")
		const py = join(root, "idf5.5_py3.14_env", "Scripts", "python.exe")
		const deps = make(
			"win32",
			[root, py],
			{ [root]: ["idf5.5_py3.14_env"] },
			{
				toolsPathHint: "C:\\Users\\dev\\.espressif", // hint exists but dir does not
			},
		)
		resolveIdfPython(deps)!.should.equal(py)
	})

	it("prefers toolsPathHint over fallback when both have python_env", () => {
		const hintRoot = join("C:\\CustomTools", "python_env")
		const hintPy = join(hintRoot, "idf5.5_py3.14_env", "Scripts", "python.exe")
		const fallbackRoot = join("C:\\", "Espressif", "python_env")
		const fallbackPy = join(fallbackRoot, "idf5.5_py3.14_env", "Scripts", "python.exe")
		const deps = make(
			"win32",
			[hintRoot, hintPy, fallbackRoot, fallbackPy],
			{
				[hintRoot]: ["idf5.5_py3.14_env"],
				[fallbackRoot]: ["idf5.5_py3.14_env"],
			},
			{ toolsPathHint: "C:\\CustomTools" },
		)
		resolveIdfPython(deps)!.should.equal(hintPy)
	})

	it("prefers the last (newest) env dir", () => {
		const root = join("/home/dev", ".espressif", "python_env")
		const newPy = join(root, "idf5.3_py3.11_env", "bin", "python")
		const deps = make("linux", [root, newPy], { [root]: ["idf5.1_py3.9_env", "idf5.3_py3.11_env"] })
		resolveIdfPython(deps)!.should.equal(newPy)
	})

	it("returns undefined when python_env is missing everywhere", () => {
		const deps = make("linux", [], {})
		;(resolveIdfPython(deps) === undefined).should.be.true()
	})
})
