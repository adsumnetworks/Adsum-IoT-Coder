import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs"
import { describe, it } from "mocha"
import { tmpdir } from "os"
import { join } from "path"
import "should"
import {
	collectBuildNcsVersions,
	isNordicBoard,
	parseSdkInstallPaths,
	resolveNrfutilCommands,
	summarizeProjectBuilds,
} from "../EnvironmentDetector"

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

	describe("sdk-manager resolved independently of device (CONFIRMED field bug)", () => {
		// Verified on a real dev machine: the launcher (`nrfutil`) and its `device` plugin
		// (`~/.nrfutil/bin/nrfutil-device`) were installed and worked — `nrfutil device list` succeeded.
		// But the launcher's `sdk-manager` plugin (`~/.nrfutil/bin/nrfutil-sdk-manager`) was NOT
		// installed; running `nrfutil sdk-manager list --json` failed with "Subcommand
		// nrfutil-sdk-manager not found", which silently looked like "zero NCS versions installed" even
		// though two NCS versions were actually present on disk. The nRF Connect extension's own
		// bundled `nrfutil-sdk-manager` binary worked fine in the same scenario.
		it("falls through to the extension's bundled sdk-manager when the launcher's own plugin is missing, while keeping device on the launcher", () => {
			const launcherDir = join(HOME, ".nrfutil", "bin")
			const launcher = join(launcherDir, "nrfutil")
			const launcherDevicePlugin = join(launcherDir, "nrfutil-device") // present — device works
			// NOTE: deliberately no "nrfutil-sdk-manager" next to the launcher.
			const extSdkBin = join(EXT, "platform", "nrfutil", "bin", "nrfutil-sdk-manager")
			const cmds = resolveNrfutilCommands(
				{ platform: "linux", env: {}, home: HOME, extensionPath: EXT },
				fsWith([launcher, launcherDevicePlugin, extSdkBin]),
			)
			cmds.devicePrefix.should.equal(`"${launcher}" device`)
			cmds.source.should.equal("launcher")
			cmds.sdkManagerPrefix.should.equal(`"${extSdkBin}"`)
			cmds.sdkManagerSource.should.equal("extension")
		})

		it("uses the launcher's own sdk-manager plugin when it IS installed locally", () => {
			const launcherDir = join(HOME, ".nrfutil", "bin")
			const launcher = join(launcherDir, "nrfutil")
			const launcherSdkPlugin = join(launcherDir, "nrfutil-sdk-manager")
			const cmds = resolveNrfutilCommands({ platform: "linux", env: {}, home: HOME }, fsWith([launcher, launcherSdkPlugin]))
			cmds.sdkManagerPrefix.should.equal(`"${launcher}" sdk-manager`)
			cmds.sdkManagerSource.should.equal("launcher")
		})

		it("treats an unverifiable launcher sdk-manager (no plugin file, no extension bundle) as path-fallback", () => {
			const launcher = join(HOME, ".nrfutil", "bin", "nrfutil")
			const cmds = resolveNrfutilCommands({ platform: "linux", env: {}, home: HOME }, fsWith([launcher]))
			// String form is unchanged (still attempts the launcher), but the source tells callers
			// this is NOT confirmed to work — selectHostNcs uses sdkManagerSource, not the prefix string.
			cmds.sdkManagerPrefix.should.equal(`"${launcher}" sdk-manager`)
			cmds.sdkManagerSource.should.equal("path-fallback")
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

describe("parseSdkInstallPaths — derives ZEPHYR_BASE source data from `sdk-manager list --json`", () => {
	// Exact shape captured from a real `nrfutil-sdk-manager list --json` run (two NCS versions
	// installed). This is the field-confirmed fix for "west: unknown command 'build'" on a
	// freestanding (out-of-tree) NCS app: west needs ZEPHYR_BASE = <dirNames[0]>/zephyr.
	const REAL_OUTPUT = JSON.stringify({
		type: "info",
		data: {
			versions: [
				{
					dirNames: ["/home/omar/ncs/v3.3.1"],
					sdkStatus: "installed",
					toolchainPath: "/home/omar/ncs/toolchains/911f4c5c26",
					toolchainStatus: "installed",
					type: "nrf",
					version: "v3.3.1",
				},
				{
					dirNames: ["/home/omar/ncs/v3.2.1"],
					sdkStatus: "installed",
					toolchainPath: "/home/omar/ncs/toolchains/43683a87ea",
					toolchainStatus: "installed",
					type: "nrf",
					version: "v3.2.1",
				},
			],
		},
	})

	it("maps each installed version (normalized, no leading v) to its install dir", () => {
		const paths = parseSdkInstallPaths(REAL_OUTPUT)
		paths.should.deepEqual({
			"3.3.1": "/home/omar/ncs/v3.3.1",
			"3.2.1": "/home/omar/ncs/v3.2.1",
		})
	})

	it("skips a version whose sdkStatus is not 'installed'", () => {
		const stdout = JSON.stringify({
			data: { versions: [{ version: "v9.9.9", dirNames: ["/x/ncs/v9.9.9"], sdkStatus: "not-installed" }] },
		})
		parseSdkInstallPaths(stdout).should.deepEqual({})
	})

	it("returns an empty map for unparseable/empty stdout", () => {
		parseSdkInstallPaths("not json\n").should.deepEqual({})
		parseSdkInstallPaths("").should.deepEqual({})
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

/**
 * The project SDK must follow the SELECTED build, not whichever was compiled most recently. The
 * selection isn't in any file, so: prefer the default `build/`, and when build configs DISAGREE on
 * NCS, surface ALL versions rather than guess. Regression for: build/ (3.2.1 selected) + build_1/
 * (3.3.1 built later) was showing 3.3.1.
 */
describe("summarizeProjectBuilds — primary + honest multi-build", () => {
	it("prefers `build/` as primary and surfaces all when builds disagree", () => {
		const s = summarizeProjectBuilds([
			{ dir: "build", version: "3.2.1", mtimeMs: 1 },
			{ dir: "build_1", version: "3.3.1", mtimeMs: 9 }, // newer, but NOT build/
		])!
		s.version.should.equal("3.2.1")
		s.allVersions!.should.deepEqual(["3.2.1", "3.3.1"])
		s.builds!.should.have.length(2)
	})

	it("with no `build/`, primary = newest by mtime; still surfaces all", () => {
		const s = summarizeProjectBuilds([
			{ dir: "build_1", version: "3.2.1", mtimeMs: 1 },
			{ dir: "build_2", version: "3.3.1", mtimeMs: 9 },
		])!
		s.version.should.equal("3.3.1")
		s.allVersions!.should.deepEqual(["3.2.1", "3.3.1"])
	})

	it("builds that AGREE → single version, no multi-build fields", () => {
		const s = summarizeProjectBuilds([
			{ dir: "build", version: "3.2.1", mtimeMs: 1 },
			{ dir: "build_1", version: "3.2.1", mtimeMs: 9 },
		])!
		s.version.should.equal("3.2.1")
		;(s.allVersions === undefined).should.be.true()
	})

	it("empty → undefined", () => {
		;(summarizeProjectBuilds([]) === undefined).should.be.true()
	})
})

describe("collectBuildNcsVersions — read each build dir's NCS (real temp dirs)", () => {
	const headerText = (v: string) => `#define NCS_VERSION_STRING           "${v}"\n`
	const writeBuild = (root: string, buildDir: string, version: string, mtime: Date) => {
		const dir = join(root, buildDir, "central_uart", "zephyr", "include", "generated")
		mkdirSync(dir, { recursive: true })
		const file = join(dir, "ncs_version.h")
		writeFileSync(file, headerText(version))
		utimesSync(file, mtime, mtime)
	}
	const OLD = new Date(Date.now() - 3_600_000)
	const NEW = new Date()

	it("returns each build dir's version, and summarize prefers build/ (3.2.1)", () => {
		const root = mkdtempSync(join(tmpdir(), "nrf-build-test-"))
		try {
			writeBuild(root, "build", "3.2.1", OLD)
			writeBuild(root, "build_1", "3.3.1", NEW)
			const found = collectBuildNcsVersions(root)
			found
				.map((b) => b.dir)
				.sort()
				.should.deepEqual(["build", "build_1"])
			found
				.map((b) => b.version)
				.sort()
				.should.deepEqual(["3.2.1", "3.3.1"])
			summarizeProjectBuilds(found)!.version.should.equal("3.2.1")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
