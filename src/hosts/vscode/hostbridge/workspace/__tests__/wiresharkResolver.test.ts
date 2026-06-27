import { expect } from "chai"
import { describe, it } from "mocha"
import {
	findOnPath,
	getWiresharkBinaryName,
	getWiresharkSearchPaths,
	resolveWiresharkBinary,
	type SupportedPlatform,
} from "../wiresharkResolver"

function fakeExists(installed: Iterable<string>, platform: SupportedPlatform) {
	const set = new Set(Array.from(installed).map((p) => (platform === "win32" ? p.toLowerCase() : p)))
	return (p: string) => set.has(platform === "win32" ? p.toLowerCase() : p)
}

describe("wiresharkResolver", () => {
	describe("getWiresharkBinaryName", () => {
		it("returns Wireshark.exe on Windows", () => {
			expect(getWiresharkBinaryName("win32")).to.equal("Wireshark.exe")
		})
		it("returns lowercase wireshark on macOS/Linux", () => {
			expect(getWiresharkBinaryName("darwin")).to.equal("wireshark")
			expect(getWiresharkBinaryName("linux")).to.equal("wireshark")
		})
	})

	describe("getWiresharkSearchPaths", () => {
		it("returns both ProgramFiles locations on Windows (Windows-first)", () => {
			const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" }
			const paths = getWiresharkSearchPaths("win32", env)
			expect(paths).to.include("C:\\Program Files\\Wireshark\\Wireshark.exe")
			expect(paths).to.include("C:\\Program Files (x86)\\Wireshark\\Wireshark.exe")
		})

		it("falls back to default ProgramFiles when env vars are missing", () => {
			const paths = getWiresharkSearchPaths("win32", {})
			expect(paths.some((p) => p.includes("C:\\Program Files\\Wireshark"))).to.be.true
		})

		it("returns the macOS app-bundle binary path", () => {
			const paths = getWiresharkSearchPaths("darwin", {})
			expect(paths).to.include("/Applications/Wireshark.app/Contents/MacOS/Wireshark")
		})

		it("returns standard Linux package-manager locations", () => {
			const paths = getWiresharkSearchPaths("linux", {})
			expect(paths).to.include("/usr/bin/wireshark")
			expect(paths).to.include("/usr/local/bin/wireshark")
		})
	})

	describe("findOnPath", () => {
		it("finds the binary in PATH on Linux", () => {
			const env = { PATH: "/usr/local/bin:/snap/bin" }
			const exists = fakeExists(["/snap/bin/wireshark"], "linux")
			expect(findOnPath("wireshark", "linux", env, exists)).to.equal("/snap/bin/wireshark")
		})

		it("uses semicolon separator on Windows", () => {
			const env = { PATH: "C:\\Windows\\System32;C:\\Tools\\Wireshark" }
			const exists = fakeExists(["C:\\Tools\\Wireshark\\Wireshark.exe"], "win32")
			expect(findOnPath("Wireshark.exe", "win32", env, exists)).to.equal("C:\\Tools\\Wireshark\\Wireshark.exe")
		})

		it("returns undefined when PATH is empty or no match", () => {
			expect(findOnPath("wireshark", "linux", {}, () => false)).to.be.undefined
			expect(findOnPath("wireshark", "linux", { PATH: "/usr/bin" }, () => false)).to.be.undefined
		})
	})

	describe("resolveWiresharkBinary", () => {
		it("prefers the user override setting when it exists", () => {
			const env = { ProgramFiles: "C:\\Program Files" }
			const installed = ["D:\\Custom\\Wireshark.exe", "C:\\Program Files\\Wireshark\\Wireshark.exe"]
			const result = resolveWiresharkBinary("win32", env, fakeExists(installed, "win32"), "D:\\Custom\\Wireshark.exe")
			expect(result).to.equal("D:\\Custom\\Wireshark.exe")
		})

		it("ignores an override that doesn't exist and falls through to deterministic paths", () => {
			const env = { ProgramFiles: "C:\\Program Files" }
			const installed = ["C:\\Program Files\\Wireshark\\Wireshark.exe"]
			const result = resolveWiresharkBinary("win32", env, fakeExists(installed, "win32"), "D:\\Nonexistent.exe")
			expect(result).to.equal("C:\\Program Files\\Wireshark\\Wireshark.exe")
		})

		it("falls through to PATH when deterministic paths miss", () => {
			const env = { PATH: "/usr/local/bin" }
			const installed = ["/usr/local/bin/wireshark"]
			const result = resolveWiresharkBinary("linux", env, fakeExists(installed, "linux"))
			expect(result).to.equal("/usr/local/bin/wireshark")
		})

		it("returns undefined when Wireshark isn't found anywhere — callers must not offer it", () => {
			const result = resolveWiresharkBinary("linux", { PATH: "/usr/bin" }, () => false)
			expect(result).to.be.undefined
		})

		it("resolves the macOS app-bundle path", () => {
			const installed = ["/Applications/Wireshark.app/Contents/MacOS/Wireshark"]
			const result = resolveWiresharkBinary("darwin", {}, fakeExists(installed, "darwin"))
			expect(result).to.equal("/Applications/Wireshark.app/Contents/MacOS/Wireshark")
		})
	})
})
