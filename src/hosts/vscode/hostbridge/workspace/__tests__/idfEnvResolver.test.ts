import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildEspShellCommand,
	buildIdfCommand,
	detectShell,
	enumerateIdfInstalls,
	getExportScriptName,
	getIdfPathCandidates,
	idfNotFoundMessage,
	isIdfDir,
	normalizeIdfVersion,
	resolveIdfPath,
	type SupportedPlatform,
	selectIdfInstall,
} from "../idfEnvResolver"

/**
 * Helper: build a fake `exists` lookup over a set of "present" absolute paths.
 * Path comparison is case-insensitive on Windows, exact elsewhere.
 */
function fakeExists(present: Iterable<string>, platform: SupportedPlatform) {
	const set = new Set(Array.from(present).map((p) => (platform === "win32" ? p.toLowerCase() : p)))
	return (p: string) => set.has(platform === "win32" ? p.toLowerCase() : p)
}

describe("idfEnvResolver", () => {
	describe("getExportScriptName", () => {
		it("returns export.ps1 for PowerShell", () => {
			expect(getExportScriptName("powershell")).to.equal("export.ps1")
		})
		it("returns export.bat for cmd", () => {
			expect(getExportScriptName("cmd")).to.equal("export.bat")
		})
		it("returns export.sh for bash and zsh", () => {
			expect(getExportScriptName("bash")).to.equal("export.sh")
			expect(getExportScriptName("zsh")).to.equal("export.sh")
		})
	})

	describe("detectShell", () => {
		it("maps powershell/pwsh to powershell", () => {
			expect(detectShell("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "win32")).to.equal("powershell")
			expect(detectShell("/usr/bin/pwsh", "linux")).to.equal("powershell")
		})
		it("maps cmd.exe to cmd", () => {
			expect(detectShell("C:\\WINDOWS\\System32\\cmd.exe", "win32")).to.equal("cmd")
		})
		it("maps zsh and bash", () => {
			expect(detectShell("/bin/zsh", "darwin")).to.equal("zsh")
			expect(detectShell("/bin/bash", "linux")).to.equal("bash")
		})
		it("falls back to the platform default for unknown shells", () => {
			expect(detectShell("", "win32")).to.equal("powershell")
			expect(detectShell("", "linux")).to.equal("bash")
			expect(detectShell("weirdshell", "darwin")).to.equal("bash")
		})
	})

	describe("isIdfDir", () => {
		it("is true when the dir contains export.sh", () => {
			const exists = fakeExists(["/home/dev/esp/esp-idf/export.sh"], "linux")
			expect(isIdfDir("linux", "/home/dev/esp/esp-idf", exists)).to.be.true
		})
		it("is false when export.sh is absent", () => {
			const exists = fakeExists([], "linux")
			expect(isIdfDir("linux", "/home/dev/esp/esp-idf", exists)).to.be.false
		})
		it("is false for an empty/undefined dir", () => {
			const exists = fakeExists(["/export.sh"], "linux")
			expect(isIdfDir("linux", "", exists)).to.be.false
		})
		it("uses Windows separators on win32", () => {
			const exists = fakeExists(["C:\\Espressif\\frameworks\\esp-idf\\export.sh"], "win32")
			expect(isIdfDir("win32", "C:\\Espressif\\frameworks\\esp-idf", exists)).to.be.true
		})
	})

	describe("getIdfPathCandidates", () => {
		it("includes the ~/esp and Espressif-installer locations on Windows", () => {
			const paths = getIdfPathCandidates("win32", { USERPROFILE: "C:\\Users\\dev" })
			expect(paths).to.include("C:\\Users\\dev\\esp\\esp-idf")
			expect(paths.some((p) => p.includes("Espressif\\frameworks\\esp-idf"))).to.be.true
		})
		it("includes ~/esp and ~/.espressif and /opt on Unix", () => {
			const paths = getIdfPathCandidates("linux", {})
			expect(paths.some((p) => p.endsWith("/esp/esp-idf"))).to.be.true
			expect(paths.some((p) => p.endsWith("/.espressif/esp-idf"))).to.be.true
			expect(paths).to.include("/opt/esp/idf")
		})
	})

	describe("resolveIdfPath", () => {
		it("prefers a valid explicit path (the ESP-IDF extension setting)", () => {
			const explicit = "/opt/custom/esp-idf"
			const exists = fakeExists([`${explicit}/export.sh`], "linux")
			expect(resolveIdfPath("linux", {}, exists, explicit)).to.equal(explicit)
		})
		it("falls back to IDF_PATH when the explicit path is invalid", () => {
			const envPath = "/home/dev/esp/esp-idf"
			const exists = fakeExists([`${envPath}/export.sh`], "linux")
			expect(resolveIdfPath("linux", { IDF_PATH: envPath }, exists, "/bad/path")).to.equal(envPath)
		})
		it("falls back to a well-known candidate when neither explicit nor env is set", () => {
			const candidates = getIdfPathCandidates("linux", {})
			const target = candidates.find((p) => p.endsWith("/esp/esp-idf"))!
			const exists = fakeExists([`${target}/export.sh`], "linux")
			expect(resolveIdfPath("linux", {}, exists)).to.equal(target)
		})
		it("returns undefined when ESP-IDF cannot be found anywhere", () => {
			const exists = fakeExists([], "linux")
			expect(resolveIdfPath("linux", {}, exists, "/bad/path")).to.be.undefined
		})
		it("resolves on Windows with case-insensitive paths", () => {
			const explicit = "C:\\Espressif\\frameworks\\esp-idf"
			const exists = fakeExists([`${explicit}\\export.sh`], "win32")
			expect(resolveIdfPath("win32", {}, exists, explicit)).to.equal(explicit)
		})
	})

	describe("buildIdfCommand", () => {
		const base = { idfPath: "/home/dev/esp/esp-idf", projectDir: "/work/my proj", idfArgs: ["build"] }

		it("sources export.sh with && on bash/zsh", () => {
			const cmd = buildIdfCommand({ platform: "linux", shell: "bash", ...base })
			expect(cmd).to.equal('. "/home/dev/esp/esp-idf/export.sh" && idf.py -C "/work/my proj" build')
		})
		it("sources export.ps1 with ; on PowerShell", () => {
			const cmd = buildIdfCommand({ platform: "linux", shell: "powershell", ...base })
			expect(cmd).to.equal('. "/home/dev/esp/esp-idf/export.ps1"; idf.py -C "/work/my proj" build')
		})
		it("uses export.bat and Windows separators on cmd", () => {
			const cmd = buildIdfCommand({
				platform: "win32",
				shell: "cmd",
				idfPath: "C:\\esp\\esp-idf",
				projectDir: "C:\\work\\proj",
				idfArgs: ["flash", "monitor"],
			})
			expect(cmd).to.equal('"C:\\esp\\esp-idf\\export.bat" && idf.py -C "C:\\work\\proj" flash monitor')
		})
		it("joins multiple idf args", () => {
			const cmd = buildIdfCommand({ platform: "linux", shell: "bash", ...base, idfArgs: ["-p", "/dev/ttyUSB0", "flash"] })
			expect(cmd).to.contain('idf.py -C "/work/my proj" -p /dev/ttyUSB0 flash')
		})
	})

	describe("buildEspShellCommand", () => {
		it("returns the body verbatim when the terminal is already sourced (Tier 1)", () => {
			const cmd = buildEspShellCommand({
				platform: "linux",
				shell: "bash",
				needsSourcing: false,
				body: "esptool.py flash_id",
			})
			expect(cmd).to.equal("esptool.py flash_id")
		})
		it("sources export.sh with && for an arbitrary body on bash/zsh (Tier 2)", () => {
			const cmd = buildEspShellCommand({
				platform: "linux",
				shell: "bash",
				needsSourcing: true,
				idfPath: "/home/dev/esp/esp-idf",
				body: "esptool.py flash_id",
			})
			expect(cmd).to.equal('. "/home/dev/esp/esp-idf/export.sh" && esptool.py flash_id')
		})
		it("uses ; on PowerShell and export.bat on cmd", () => {
			expect(
				buildEspShellCommand({
					platform: "linux",
					shell: "powershell",
					needsSourcing: true,
					idfPath: "/home/dev/esp/esp-idf",
					body: "idf.py --version",
				}),
			).to.equal('. "/home/dev/esp/esp-idf/export.ps1"; idf.py --version')
			expect(
				buildEspShellCommand({
					platform: "win32",
					shell: "cmd",
					needsSourcing: true,
					idfPath: "C:\\esp\\esp-idf",
					body: "idf.py size",
				}),
			).to.equal('"C:\\esp\\esp-idf\\export.bat" && idf.py size')
		})
	})

	describe("idfNotFoundMessage", () => {
		it("is actionable and mentions the extension setting + IDF_PATH", () => {
			const msg = idfNotFoundMessage("linux")
			expect(msg).to.contain("ESP-IDF")
			expect(msg).to.contain("IDF_PATH")
			expect(msg).to.contain("~/esp/esp-idf")
		})
		it("uses a Windows-style example path on win32", () => {
			expect(idfNotFoundMessage("win32")).to.contain("%USERPROFILE%")
		})
	})

	describe("normalizeIdfVersion", () => {
		it("strips a leading v", () => expect(normalizeIdfVersion("v5.5.2")).to.equal("5.5.2"))
		it("keeps a bare version", () => expect(normalizeIdfVersion("5.5.2")).to.equal("5.5.2"))
		it("handles a version.txt body with trailing text", () => expect(normalizeIdfVersion("v6.0\n")).to.equal("6.0"))
		it("returns undefined for empty/undefined", () => {
			expect(normalizeIdfVersion("")).to.equal(undefined)
			expect(normalizeIdfVersion(undefined)).to.equal(undefined)
		})
	})

	describe("selectIdfInstall (pin-aware)", () => {
		const a = { path: "/esp/v5.5.2/esp-idf", version: "5.5.2" }
		const b = { path: "/esp/v6.0/esp-idf", version: "6.0" }

		it("auto-picks the install matching the project pin (over the explicit setting)", () => {
			const sel = selectIdfInstall([a, b], "5.5.2", b.path)
			expect(sel).to.deep.equal({ kind: "resolved", path: a.path, version: "5.5.2" })
		})
		it("matches a pin written with a leading v", () => {
			const sel = selectIdfInstall([a, b], "v6.0")
			expect(sel.kind).to.equal("resolved")
			expect((sel as any).path).to.equal(b.path)
		})
		it("is ambiguous when several installs and no pin", () => {
			expect(selectIdfInstall([a, b]).kind).to.equal("ambiguous")
		})
		it("prefers the explicit setting when there is no pin", () => {
			expect((selectIdfInstall([a, b], undefined, b.path) as any).path).to.equal(b.path)
		})
		it("uses the sole install even if the pin is not installed", () => {
			expect((selectIdfInstall([a], "9.9.9") as any).path).to.equal(a.path)
		})
		it("is ambiguous when the pin is not installed and several exist", () => {
			expect(selectIdfInstall([a, b], "9.9.9").kind).to.equal("ambiguous")
		})
		it("is none when nothing is installed", () => {
			expect(selectIdfInstall([]).kind).to.equal("none")
		})
	})

	describe("enumerateIdfInstalls", () => {
		it("globs ~/esp/<ver>/esp-idf and reads each version (de-duped)", () => {
			const espParent = path.posix.join(os.homedir(), "esp")
			const v552 = path.posix.join(espParent, "v5.5.2", "esp-idf")
			const v60 = path.posix.join(espParent, "v6.0", "esp-idf")
			const exists = (p: string) => p === `${v552}/export.sh` || p === `${v60}/export.sh`
			const listDir = (p: string) => (p === espParent ? ["v5.5.2", "v6.0"] : [])
			const readVersion = (dir: string) => (dir === v552 ? "v5.5.2" : dir === v60 ? "6.0" : undefined)

			const installs = enumerateIdfInstalls("linux", {}, exists, listDir, readVersion)
			const byPath = Object.fromEntries(installs.map((i) => [i.path, i.version]))
			expect(byPath[v552]).to.equal("5.5.2")
			expect(byPath[v60]).to.equal("6.0")
		})
		it("finds C:\\esp\\<ver>\\esp-idf (extension container on C:, the win32 regression)", () => {
			const idf = "C:\\esp\\v5.5.4\\esp-idf"
			const exists = fakeExists([`${idf}\\export.sh`], "win32")
			const listDir = (p: string) => (p === "C:\\esp" ? ["v5.5.4"] : [])
			const installs = enumerateIdfInstalls("win32", {}, exists, listDir, () => "v5.5.4")
			expect(installs.map((i) => i.path)).to.include(idf)
		})
		it("finds C:\\Espressif\\frameworks\\esp-idf-v5.x (IDF Tools installer, entry IS the root)", () => {
			const idf = "C:\\Espressif\\frameworks\\esp-idf-v5.5"
			const exists = fakeExists([`${idf}\\export.sh`], "win32")
			const listDir = (p: string) => (p === "C:\\Espressif\\frameworks" ? ["esp-idf-v5.5"] : [])
			const installs = enumerateIdfInstalls("win32", {}, exists, listDir, () => undefined)
			expect(installs.map((i) => i.path)).to.include(idf)
		})
		it("includes the explicit setting and IDF_PATH", () => {
			const exists = (p: string) => p === "/opt/idf/export.sh" || p === "/env/idf/export.sh"
			const installs = enumerateIdfInstalls(
				"linux",
				{ IDF_PATH: "/env/idf" },
				exists,
				() => [],
				() => undefined,
				"/opt/idf",
			)
			const paths = installs.map((i) => i.path)
			expect(paths).to.include("/opt/idf")
			expect(paths).to.include("/env/idf")
		})
	})
})
