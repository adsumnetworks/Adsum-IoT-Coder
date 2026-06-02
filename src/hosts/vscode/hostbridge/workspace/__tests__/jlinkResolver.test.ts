import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildJLinkArgs,
	expandVersionedJLinkDirs,
	findOnPath,
	getJLinkBinaryName,
	getJLinkSearchPaths,
	resolveJLinkBinary,
	type SupportedPlatform,
} from "../jlinkResolver"

/**
 * Helper: build a fake `exists` lookup over a set of "installed" absolute paths.
 * Path comparison is case-insensitive on Windows (NTFS), exact elsewhere.
 */
function fakeExists(installed: Iterable<string>, platform: SupportedPlatform) {
	const set = new Set(Array.from(installed).map((p) => (platform === "win32" ? p.toLowerCase() : p)))
	return (p: string) => set.has(platform === "win32" ? p.toLowerCase() : p)
}

/** Helper: fake `readdir` that returns entries only for known parents. */
function fakeReaddir(layout: Record<string, string[]>) {
	return (dir: string) => {
		if (dir in layout) return layout[dir]
		throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
	}
}

describe("jlinkResolver", () => {
	describe("getJLinkBinaryName", () => {
		it("returns JLink.exe on Windows", () => {
			expect(getJLinkBinaryName("win32")).to.equal("JLink.exe")
		})

		it("returns JLinkExe on macOS", () => {
			expect(getJLinkBinaryName("darwin")).to.equal("JLinkExe")
		})

		it("returns JLinkExe on Linux", () => {
			expect(getJLinkBinaryName("linux")).to.equal("JLinkExe")
		})

		it("falls back to JLinkExe for unknown platforms", () => {
			expect(getJLinkBinaryName("freebsd" as NodeJS.Platform)).to.equal("JLinkExe")
		})
	})

	describe("getJLinkSearchPaths", () => {
		it("returns Windows install locations using ProgramFiles env vars", () => {
			const env = {
				ProgramFiles: "C:\\Program Files",
				"ProgramFiles(x86)": "C:\\Program Files (x86)",
				LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
			}
			const paths = getJLinkSearchPaths("win32", env)
			expect(paths).to.include("C:\\Program Files\\SEGGER\\JLink\\JLink.exe")
			expect(paths).to.include("C:\\Program Files (x86)\\SEGGER\\JLink\\JLink.exe")
			expect(paths).to.include("C:\\Program Files\\Nordic Semiconductor\\nrf-command-line-tools\\bin\\JLink.exe")
			expect(paths).to.include("C:\\Users\\dev\\AppData\\Local\\Programs\\SEGGER\\JLink\\JLink.exe")
		})

		it("falls back to default ProgramFiles when env vars are missing on Windows", () => {
			const paths = getJLinkSearchPaths("win32", {})
			expect(paths.some((p) => p.includes("C:\\Program Files\\SEGGER"))).to.be.true
			expect(paths.some((p) => p.includes("C:\\Program Files (x86)\\SEGGER"))).to.be.true
		})

		it("returns macOS install locations including Apple Silicon Homebrew", () => {
			const paths = getJLinkSearchPaths("darwin", {})
			expect(paths).to.include("/Applications/SEGGER/JLink/JLinkExe")
			expect(paths).to.include("/usr/local/bin/JLinkExe") // Intel Homebrew
			expect(paths).to.include("/opt/homebrew/bin/JLinkExe") // Apple Silicon Homebrew
			expect(paths).to.include("/opt/SEGGER/JLink/JLinkExe")
		})

		it("returns Linux install locations including ~/.local/bin and NCS toolchain", () => {
			const paths = getJLinkSearchPaths("linux", {})
			expect(paths).to.include("/opt/SEGGER/JLink/JLinkExe")
			expect(paths).to.include("/usr/bin/JLinkExe")
			expect(paths).to.include("/usr/local/bin/JLinkExe")
			expect(paths.some((p) => p.endsWith("/.local/bin/JLinkExe"))).to.be.true
			expect(paths).to.include("/opt/nordic/ncs/toolchains/bin/JLinkExe")
		})

		it("never produces /bin/bash or other shell-related paths", () => {
			// Regression guard against the original bug
			for (const platform of ["win32", "darwin", "linux"] as const) {
				const paths = getJLinkSearchPaths(platform, {})
				for (const p of paths) {
					expect(p).to.not.match(/bin\/(ba)?sh$/)
					expect(p.toLowerCase()).to.not.include("cmd.exe")
				}
			}
		})
	})

	describe("expandVersionedJLinkDirs", () => {
		it("discovers JLink_V876 under SEGGER on Windows", () => {
			const layout = {
				"C:\\Program Files\\SEGGER": ["JLink", "JLink_V876", "Ozone"],
			}
			const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" }
			const result = expandVersionedJLinkDirs("win32", env, fakeReaddir(layout))
			// Skips plain "JLink" (covered by getJLinkSearchPaths) and "Ozone"
			expect(result).to.deep.equal(["C:\\Program Files\\SEGGER\\JLink_V876\\JLink.exe"])
		})

		it("discovers JLink_V780 under /Applications/SEGGER on macOS", () => {
			const layout = { "/Applications/SEGGER": ["JLink", "JLink_V780", "Ozone"] }
			const result = expandVersionedJLinkDirs("darwin", {}, fakeReaddir(layout))
			expect(result).to.deep.equal(["/Applications/SEGGER/JLink_V780/JLinkExe"])
		})

		it("discovers JLink_V792a under /opt/SEGGER on Linux", () => {
			const layout = { "/opt/SEGGER": ["JLink", "JLink_V792a"] }
			const result = expandVersionedJLinkDirs("linux", {}, fakeReaddir(layout))
			expect(result).to.deep.equal(["/opt/SEGGER/JLink_V792a/JLinkExe"])
		})

		it("returns empty array when SEGGER parent does not exist", () => {
			const result = expandVersionedJLinkDirs("linux", {}, fakeReaddir({}))
			expect(result).to.deep.equal([])
		})

		it("never returns the plain JLink directory (handled by getJLinkSearchPaths)", () => {
			const layout = { "/opt/SEGGER": ["JLink"] }
			const result = expandVersionedJLinkDirs("linux", {}, fakeReaddir(layout))
			expect(result).to.deep.equal([])
		})

		it("checks both ProgramFiles and ProgramFiles(x86) parents on Windows", () => {
			const layout = {
				"C:\\Program Files\\SEGGER": ["JLink_V876"],
				"C:\\Program Files (x86)\\SEGGER": ["JLink_V870"],
			}
			const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" }
			const result = expandVersionedJLinkDirs("win32", env, fakeReaddir(layout))
			expect(result).to.have.lengthOf(2)
			expect(result).to.include("C:\\Program Files\\SEGGER\\JLink_V876\\JLink.exe")
			expect(result).to.include("C:\\Program Files (x86)\\SEGGER\\JLink_V870\\JLink.exe")
		})
	})

	describe("findOnPath", () => {
		it("finds binary in first PATH entry on Linux", () => {
			const env = { PATH: "/usr/local/bin:/usr/bin:/bin" }
			const exists = fakeExists(["/usr/local/bin/JLinkExe"], "linux")
			expect(findOnPath("JLinkExe", "linux", env, exists)).to.equal("/usr/local/bin/JLinkExe")
		})

		it("finds binary in later PATH entry on Linux", () => {
			const env = { PATH: "/usr/local/bin:/usr/bin:/bin" }
			const exists = fakeExists(["/bin/JLinkExe"], "linux")
			expect(findOnPath("JLinkExe", "linux", env, exists)).to.equal("/bin/JLinkExe")
		})

		it("uses semicolon separator on Windows", () => {
			const env = { PATH: "C:\\Windows\\System32;C:\\Tools\\JLink" }
			const exists = fakeExists(["C:\\Tools\\JLink\\JLink.exe"], "win32")
			expect(findOnPath("JLink.exe", "win32", env, exists)).to.equal("C:\\Tools\\JLink\\JLink.exe")
		})

		it("tolerates lowercase 'Path' env var on Windows", () => {
			const env = { Path: "C:\\Tools" }
			const exists = fakeExists(["C:\\Tools\\JLink.exe"], "win32")
			expect(findOnPath("JLink.exe", "win32", env, exists)).to.equal("C:\\Tools\\JLink.exe")
		})

		it("returns undefined when PATH is empty", () => {
			const exists = () => false
			expect(findOnPath("JLinkExe", "linux", { PATH: "" }, exists)).to.be.undefined
			expect(findOnPath("JLinkExe", "linux", {}, exists)).to.be.undefined
		})

		it("returns undefined when binary not found in any PATH entry", () => {
			const env = { PATH: "/usr/local/bin:/usr/bin" }
			const exists = () => false
			expect(findOnPath("JLinkExe", "linux", env, exists)).to.be.undefined
		})

		it("skips empty PATH entries (e.g. double colon)", () => {
			const env = { PATH: "/usr/bin::/usr/local/bin" }
			const exists = fakeExists(["/usr/local/bin/JLinkExe"], "linux")
			// Should not blow up on the empty middle entry
			expect(findOnPath("JLinkExe", "linux", env, exists)).to.equal("/usr/local/bin/JLinkExe")
		})

		it("handles paths with spaces (Program Files)", () => {
			const env = { PATH: "C:\\Program Files\\SEGGER\\JLink" }
			const exists = fakeExists(["C:\\Program Files\\SEGGER\\JLink\\JLink.exe"], "win32")
			expect(findOnPath("JLink.exe", "win32", env, exists)).to.equal("C:\\Program Files\\SEGGER\\JLink\\JLink.exe")
		})
	})

	describe("resolveJLinkBinary", () => {
		it("prefers deterministic install paths over PATH lookup on Windows", () => {
			const env = {
				ProgramFiles: "C:\\Program Files",
				"ProgramFiles(x86)": "C:\\Program Files (x86)",
				PATH: "C:\\Tools",
			}
			const installed = [
				"C:\\Program Files\\SEGGER\\JLink\\JLink.exe", // deterministic
				"C:\\Tools\\JLink.exe", // also on PATH
			]
			const result = resolveJLinkBinary("win32", env, fakeExists(installed, "win32"), fakeReaddir({}))
			expect(result).to.equal("C:\\Program Files\\SEGGER\\JLink\\JLink.exe")
		})

		it("falls through to versioned SEGGER dir when deterministic paths miss", () => {
			const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" }
			const installed = ["C:\\Program Files\\SEGGER\\JLink_V876\\JLink.exe"]
			const layout = { "C:\\Program Files\\SEGGER": ["JLink_V876"] }
			const result = resolveJLinkBinary("win32", env, fakeExists(installed, "win32"), fakeReaddir(layout))
			expect(result).to.equal("C:\\Program Files\\SEGGER\\JLink_V876\\JLink.exe")
		})

		it("falls through to PATH when both deterministic and versioned lookups miss", () => {
			const env = { PATH: "/usr/local/bin:/usr/bin" }
			const installed = ["/usr/local/bin/JLinkExe"]
			const result = resolveJLinkBinary("linux", env, fakeExists(installed, "linux"), fakeReaddir({}))
			expect(result).to.equal("/usr/local/bin/JLinkExe")
		})

		it("returns undefined when nothing matches on any tier", () => {
			const result = resolveJLinkBinary("linux", { PATH: "/usr/bin" }, () => false, fakeReaddir({}))
			expect(result).to.be.undefined
		})

		it("resolves Apple Silicon Homebrew on macOS", () => {
			const installed = ["/opt/homebrew/bin/JLinkExe"]
			const result = resolveJLinkBinary("darwin", {}, fakeExists(installed, "darwin"), fakeReaddir({}))
			expect(result).to.equal("/opt/homebrew/bin/JLinkExe")
		})

		it("resolves Intel macOS Homebrew on macOS", () => {
			const installed = ["/usr/local/bin/JLinkExe"]
			const result = resolveJLinkBinary("darwin", {}, fakeExists(installed, "darwin"), fakeReaddir({}))
			expect(result).to.equal("/usr/local/bin/JLinkExe")
		})

		it("resolves Linux .deb install location", () => {
			const installed = ["/opt/SEGGER/JLink/JLinkExe"]
			const result = resolveJLinkBinary("linux", {}, fakeExists(installed, "linux"), fakeReaddir({}))
			expect(result).to.equal("/opt/SEGGER/JLink/JLinkExe")
		})

		it("never returns the legacy hardcoded /bin/bash path (regression guard)", () => {
			const installed = ["/bin/bash"]
			const result = resolveJLinkBinary("linux", { PATH: "/bin" }, fakeExists(installed, "linux"), fakeReaddir({}))
			expect(result).to.be.undefined
		})
	})

	describe("buildJLinkArgs", () => {
		it("builds CLI args in the SEGGER-expected order", () => {
			const args = buildJLinkArgs({ deviceName: "nRF52840_xxAA", serialNumber: "683335182", rttPort: 19021 })
			expect(args).to.deep.equal([
				"-device",
				"nRF52840_xxAA",
				"-SelectEmuBySN",
				"683335182",
				"-if",
				"swd",
				"-speed",
				"auto",
				"-AutoConnect",
				"1",
				"-RTTTelnetPort",
				"19021",
			])
		})

		it("stringifies the RTT port (numeric input → string output for shellArgs)", () => {
			const args = buildJLinkArgs({ deviceName: "nRF53", serialNumber: "1", rttPort: 12345 })
			expect(args).to.include("12345")
			expect(args.every((a) => typeof a === "string")).to.be.true
		})

		it("preserves device names with underscores and case (nRF SDK convention)", () => {
			const args = buildJLinkArgs({ deviceName: "nRF5340_xxAA_APP", serialNumber: "1050000000", rttPort: 19021 })
			expect(args).to.include("nRF5340_xxAA_APP")
		})

		it("never embeds args inside a single shell string (regression guard)", () => {
			// The original bug joined args into a single bash -c string. The new API
			// returns them separately so no shell escaping ever happens.
			const args = buildJLinkArgs({ deviceName: "X", serialNumber: "Y", rttPort: 1 })
			for (const a of args) {
				expect(a).to.not.match(/\s/) // no embedded spaces, no shell-quoted blobs
			}
		})
	})
})
