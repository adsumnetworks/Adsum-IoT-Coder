import { describe, it } from "mocha"
import "should"
import { join } from "path"
import { isNordicBoard, resolveNrfutilCommands } from "../EnvironmentDetector"

/**
 * resolveNrfutilCommands picks how to invoke nrfutil across the two layouts it ships in:
 *  - launcher (`nrfutil device …`) — standalone install at ~/.nrfutil/bin, typical on macOS/Linux
 *  - split binaries (`nrfutil-device …`) — bundled by the nRF Connect VS Code extension, the only
 *    nrfutil present on a stock Windows install
 *
 * The critical safety property: **a launcher, when present, always wins** — so the macOS/Linux path
 * that works today is never silently switched to the extension form.
 */
describe("resolveNrfutilCommands", () => {
	const HOME = "/Users/dev"
	const WIN_HOME = "C:\\Users\\dev"
	const EXT = "/Users/dev/.vscode/extensions/nordic-semiconductor.nrf-connect-2026.4.1766"
	const WIN_EXT = "C:\\Users\\dev\\.vscode\\extensions\\nordic-semiconductor.nrf-connect-2026.4.1766-win32-x64"

	// existsSync stub that returns true only for the given set of paths.
	const fsWith = (present: string[]) => (p: string) => present.includes(p)

	describe("macOS / Linux — launcher present (must stay exactly as before)", () => {
		it("uses the ~/.nrfutil launcher on macOS", () => {
			const launcher = join(HOME, ".nrfutil", "bin", "nrfutil")
			const cmds = resolveNrfutilCommands({ platform: "darwin", env: {}, home: HOME }, fsWith([launcher]))
			cmds.source.should.equal("launcher")
			cmds.devicePrefix.should.equal(`"${launcher}" device`)
			cmds.sdkManagerPrefix.should.equal(`"${launcher}" sdk-manager`)
		})

		it("uses the ~/.nrfutil launcher on Linux", () => {
			const launcher = join(HOME, ".nrfutil", "bin", "nrfutil")
			const cmds = resolveNrfutilCommands({ platform: "linux", env: {}, home: HOME }, fsWith([launcher]))
			cmds.source.should.equal("launcher")
			cmds.devicePrefix.should.equal(`"${launcher}" device`)
		})

		it("prefers NRFUTIL_HOME over the canonical location", () => {
			const sandbox = "/opt/nrfutil"
			const launcher = join(sandbox, "bin", "nrfutil")
			const cmds = resolveNrfutilCommands(
				{ platform: "linux", env: { NRFUTIL_HOME: sandbox }, home: HOME },
				fsWith([launcher, join(HOME, ".nrfutil", "bin", "nrfutil")]),
			)
			cmds.devicePrefix.should.equal(`"${launcher}" device`)
		})

		it("THE SAFETY PROPERTY: a launcher beats an extension bundle when both exist", () => {
			const launcher = join(HOME, ".nrfutil", "bin", "nrfutil")
			const extDevice = join(EXT, "platform", "nrfutil", "bin", "nrfutil-device")
			const cmds = resolveNrfutilCommands(
				{ platform: "darwin", env: {}, home: HOME, extensionPath: EXT },
				fsWith([launcher, extDevice]),
			)
			cmds.source.should.equal("launcher")
			cmds.devicePrefix.should.equal(`"${launcher}" device`)
		})
	})

	describe("Windows — no launcher, only the extension bundle (the bug being fixed)", () => {
		it("resolves the split nrfutil-device.exe / nrfutil-sdk-manager.exe binaries", () => {
			const binDir = join(WIN_EXT, "platform", "nrfutil", "bin")
			const deviceBin = join(binDir, "nrfutil-device.exe")
			const sdkBin = join(binDir, "nrfutil-sdk-manager.exe")
			const cmds = resolveNrfutilCommands(
				{ platform: "win32", env: {}, home: WIN_HOME, extensionPath: WIN_EXT },
				fsWith([deviceBin, sdkBin]),
			)
			cmds.source.should.equal("extension")
			cmds.devicePrefix.should.equal(`"${deviceBin}"`)
			cmds.sdkManagerPrefix.should.equal(`"${sdkBin}"`)
		})

		it("produces a valid `device list` command form (no 'device' subcommand token for split binaries)", () => {
			const deviceBin = join(WIN_EXT, "platform", "nrfutil", "bin", "nrfutil-device.exe")
			const cmds = resolveNrfutilCommands(
				{ platform: "win32", env: {}, home: WIN_HOME, extensionPath: WIN_EXT },
				fsWith([deviceBin]),
			)
			// The caller appends ` list --json`; the split binary must NOT carry a `device` token.
			const fullCmd = `${cmds.devicePrefix} list --json`
			fullCmd.should.equal(`"${deviceBin}" list --json`)
		})

		it("falls back to a bare sdk-manager launcher form if only the device binary is bundled", () => {
			const deviceBin = join(WIN_EXT, "platform", "nrfutil", "bin", "nrfutil-device.exe")
			const cmds = resolveNrfutilCommands(
				{ platform: "win32", env: {}, home: WIN_HOME, extensionPath: WIN_EXT },
				fsWith([deviceBin]), // sdk-manager binary absent
			)
			cmds.devicePrefix.should.equal(`"${deviceBin}"`)
			cmds.sdkManagerPrefix.should.equal("nrfutil.exe sdk-manager")
		})
	})

	describe("nothing found — PATH fallback", () => {
		it("returns bare launcher forms on Windows", () => {
			const cmds = resolveNrfutilCommands(
				{ platform: "win32", env: {}, home: WIN_HOME, extensionPath: WIN_EXT },
				fsWith([]),
			)
			cmds.source.should.equal("path-fallback")
			cmds.devicePrefix.should.equal("nrfutil.exe device")
			cmds.sdkManagerPrefix.should.equal("nrfutil.exe sdk-manager")
		})

		it("returns bare launcher forms on macOS/Linux", () => {
			const cmds = resolveNrfutilCommands({ platform: "linux", env: {}, home: HOME }, fsWith([]))
			cmds.source.should.equal("path-fallback")
			cmds.devicePrefix.should.equal("nrfutil device")
			cmds.sdkManagerPrefix.should.equal("nrfutil sdk-manager")
		})
	})
})

describe("isNordicBoard — filter out non-Nordic enumerated serial ports (e.g. ESP)", () => {
	it("keeps a board with a Nordic deviceName", () => {
		isNordicBoard({ serialNumber: "5B5F121973", deviceName: "nRF52840", boardVersion: "PCA10056" }).should.be.true()
	})

	it("keeps a board with only a deviceFamily", () => {
		isNordicBoard({ serialNumber: "1050001234", deviceFamily: "NRF53" }).should.be.true()
	})

	it("drops an ESP device that came through as a bare serial number", () => {
		isNordicBoard({ serialNumber: "5B5F121973" }).should.be.false()
	})

	it("drops a bare-serial device with no chip identity", () => {
		isNordicBoard({ serialNumber: "0001" }).should.be.false()
	})
})
