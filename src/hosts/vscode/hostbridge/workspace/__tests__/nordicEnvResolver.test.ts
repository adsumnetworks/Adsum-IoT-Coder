import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildNordicLoggerCommand,
	buildToolchainCommand,
	ncsAmbiguousMessage,
	normalizeNcsVersion,
	parseToolchainEnv,
	pathListSep,
	selectNcsInstall,
	toNcsVersionFlag,
} from "../nordicEnvResolver"

describe("nordicEnvResolver", () => {
	describe("normalizeNcsVersion", () => {
		it("strips a leading v", () => expect(normalizeNcsVersion("v3.2.1")).to.equal("3.2.1"))
		it("keeps a bare version", () => expect(normalizeNcsVersion("3.2.1")).to.equal("3.2.1"))
		it("trims surrounding whitespace / newline", () => expect(normalizeNcsVersion(" v3.3.0\n")).to.equal("3.3.0"))
		it("returns undefined for empty/undefined", () => {
			expect(normalizeNcsVersion("")).to.equal(undefined)
			expect(normalizeNcsVersion(undefined)).to.equal(undefined)
		})
	})

	describe("toNcsVersionFlag", () => {
		it("re-adds the v prefix", () => expect(toNcsVersionFlag("3.2.1")).to.equal("v3.2.1"))
		it("is idempotent on an already-prefixed value", () => expect(toNcsVersionFlag("v3.2.1")).to.equal("v3.2.1"))
	})

	describe("pathListSep", () => {
		it("is ; on win32 and : elsewhere", () => {
			expect(pathListSep("win32")).to.equal(";")
			expect(pathListSep("linux")).to.equal(":")
			expect(pathListSep("darwin")).to.equal(":")
		})
	})

	describe("selectNcsInstall (pin-aware)", () => {
		const installed = ["v3.2.1", "v3.3.0"]

		it("explicit wins over everything (and need not be installed)", () => {
			const sel = selectNcsInstall(installed, { explicit: "v9.9.9", persisted: "v3.2.1", pinned: "v3.3.0" })
			expect(sel).to.deep.equal({ kind: "resolved", version: "9.9.9" })
		})
		it("uses the persisted choice when installed (over the pin)", () => {
			const sel = selectNcsInstall(installed, { persisted: "v3.3.0", pinned: "3.2.1" })
			expect(sel).to.deep.equal({ kind: "resolved", version: "3.3.0" })
		})
		it("uses the project pin when installed and nothing higher-priority decides", () => {
			const sel = selectNcsInstall(installed, { pinned: "3.2.1" })
			expect(sel).to.deep.equal({ kind: "resolved", version: "3.2.1" })
		})
		it("ignores a persisted/pin value that is not installed", () => {
			const sel = selectNcsInstall(installed, { persisted: "v1.0.0", pinned: "v2.0.0" })
			expect(sel.kind).to.equal("ambiguous")
		})
		it("resolves the sole install even with a non-matching pin", () => {
			const sel = selectNcsInstall(["v3.2.1"], { pinned: "v9.9.9" })
			expect(sel).to.deep.equal({ kind: "resolved", version: "3.2.1" })
		})
		it("is ambiguous with several installs and no decisive input", () => {
			expect(selectNcsInstall(installed).kind).to.equal("ambiguous")
			expect((selectNcsInstall(installed) as any).versions).to.deep.equal(["3.2.1", "3.3.0"])
		})
		it("is none when nothing is installed", () => {
			expect(selectNcsInstall([]).kind).to.equal("none")
		})
		it("matches a pin written without the v against v-prefixed installs", () => {
			const sel = selectNcsInstall(["v3.2.1", "v3.3.0"], { pinned: "3.3.0" })
			expect(sel).to.deep.equal({ kind: "resolved", version: "3.3.0" })
		})
	})

	describe("parseToolchainEnv", () => {
		it("parses KEY : VALUE lines, keeping colons inside the value", () => {
			const stdout = [
				"Some banner line without a colon separator",
				"PATH                     : C:\\ncs\\toolchains\\abc\\bin;C:\\ncs\\toolchains\\abc\\opt\\bin",
				"ZEPHYR_SDK_INSTALL_DIR   : C:\\ncs\\toolchains\\abc\\opt\\zephyr-sdk",
				"ZEPHYR_TOOLCHAIN_VARIANT : zephyr",
				"",
			].join("\n")
			const env = parseToolchainEnv(stdout)
			expect(env.PATH).to.equal("C:\\ncs\\toolchains\\abc\\bin;C:\\ncs\\toolchains\\abc\\opt\\bin")
			expect(env.ZEPHYR_SDK_INSTALL_DIR).to.equal("C:\\ncs\\toolchains\\abc\\opt\\zephyr-sdk")
			expect(env.ZEPHYR_TOOLCHAIN_VARIANT).to.equal("zephyr")
			expect(env).to.not.have.property("Some")
		})
		it("handles unix PATH with colon separators", () => {
			const env = parseToolchainEnv("PATH : /home/u/ncs/toolchains/abc/bin:/usr/bin")
			expect(env.PATH).to.equal("/home/u/ncs/toolchains/abc/bin:/usr/bin")
		})
		it("returns an empty map when there is nothing parseable", () => {
			expect(parseToolchainEnv("progress... done\n\n")).to.deep.equal({})
		})
	})

	describe("buildToolchainCommand (ncs)", () => {
		it("emits a single launch command, v-prefixed, no shell chaining", () => {
			const cmd = buildToolchainCommand("ncs", {
				sdkManagerPrefix: '"/home/u/.nrfutil/bin/nrfutil" sdk-manager',
				version: "3.2.1",
				body: 'west build -b nrf52840dk/nrf52840 -C "/work/app"',
			})
			expect(cmd).to.equal(
				'"/home/u/.nrfutil/bin/nrfutil" sdk-manager toolchain launch --ncs-version v3.2.1 -- ' +
					'west build -b nrf52840dk/nrf52840 -C "/work/app"',
			)
			expect(cmd).to.not.contain("&&")
		})
	})

	describe("buildNordicLoggerCommand", () => {
		const wrapperInvocation = '"./assets/scripts/rtt-logger" --capture --port 1050000000'
		it("runs the quoted wrapper bare on bash/zsh", () => {
			expect(buildNordicLoggerCommand({ platform: "linux", shell: "bash", wrapperInvocation })).to.equal(wrapperInvocation)
			expect(buildNordicLoggerCommand({ platform: "darwin", shell: "zsh", wrapperInvocation })).to.equal(wrapperInvocation)
		})
		it("prepends the call operator on PowerShell", () => {
			expect(buildNordicLoggerCommand({ platform: "win32", shell: "powershell", wrapperInvocation })).to.equal(
				`& ${wrapperInvocation}`,
			)
		})
		it("runs the quoted wrapper bare on cmd", () => {
			const win = '".\\assets\\scripts\\rtt-logger.bat" --capture --port 1050000000'
			expect(buildNordicLoggerCommand({ platform: "win32", shell: "cmd", wrapperInvocation: win })).to.equal(win)
		})
	})

	describe("ncsAmbiguousMessage", () => {
		it("lists the installed versions and tells the agent to pass ncs_version", () => {
			const msg = ncsAmbiguousMessage(["v3.2.1", "3.3.0"])
			expect(msg).to.contain("v3.2.1")
			expect(msg).to.contain("v3.3.0")
			expect(msg).to.contain("ncs_version")
		})
	})
})
