/**
 * The facts the extension's own Python is set up from, per system. Pure: no file system, no process.
 *
 * Why the Python is set up on the developer's computer and not shipped inside the VSIX (18 Oct 2026, the operator
 * and Ismail): 0.5.1 carried five platform packages, each with a Python built for its system on one Mac. pip on a
 * Mac cannot resolve another system's dependencies, so the Windows list was written by hand with `--no-deps` and
 * missed `typing_extensions` (winrt-runtime requires it): every Windows scan failed. Here pip runs on the computer
 * the packages are for, with their dependencies, so it picks what that system needs, and one universal VSIX serves
 * every system.
 *
 * The portable CPython is python-build-standalone's relocatable build (the same release the platform packages used),
 * checked against the SHA-256 its release publishes. The hashes below are copied from that release's SHA256SUMS.
 */

export type RuntimeTarget = "win32-x64" | "win32-arm64" | "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64"

export type BluetoothBackend = "winrt" | "corebluetooth" | "bluezdbus"

export const PBS_RELEASE = "20261009"
export const CPYTHON = "3.12.15"
/** Bump when the requirements below change: a new revision is built beside the old one, never over it. */
export const RUNTIME_REVISION = 1

const PBS_BASE = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}`

interface TargetFacts {
	triple: string
	sha256: string
}

export const TARGETS: Readonly<Record<RuntimeTarget, TargetFacts>> = {
	"win32-x64": {
		triple: "x86_64-pc-windows-msvc",
		sha256: "11ed9f8a6ac64fb1b5a55e40e305a6744a3f77a70863c8f8197a6e4349abc64a",
	},
	"win32-arm64": {
		triple: "aarch64-pc-windows-msvc",
		sha256: "e2c1d6de6311d95b7bfaf3c46587cb5682e43415c19fcbef97595cb0b262f614",
	},
	"darwin-arm64": {
		triple: "aarch64-apple-darwin",
		sha256: "233f8e15255b3e1d1fd47ea5dd5230dfed803f371138e896e54d98c60ae19f6f",
	},
	"darwin-x64": {
		triple: "x86_64-apple-darwin",
		sha256: "fb3187d95334813b88940db0f1ca57b84cedfd552739c3a5771c3ea0e49988c9",
	},
	"linux-x64": {
		triple: "x86_64-unknown-linux-gnu",
		sha256: "ffa8f85f1b56e88b687f08d743d817015524b86a9365fd921243132b80f1a36d",
	},
	"linux-arm64": {
		triple: "aarch64-unknown-linux-gnu",
		sha256: "2e1ba0e7f22e01c534caebf7f09e7820322bc0d055271d3434af671e8400f96f",
	},
}

/** This computer's system, or null where no portable Python is published for it (then a system Python is used). */
export function runtimeTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): RuntimeTarget | null {
	const key = `${platform}-${arch}`
	return key in TARGETS ? (key as RuntimeTarget) : null
}

export function pbsAsset(target: RuntimeTarget): string {
	return `cpython-${CPYTHON}+${PBS_RELEASE}-${TARGETS[target].triple}-install_only_stripped.tar.gz`
}

/** Where the portable Python comes from. `mirror` replaces the release folder (a company mirror, or a test). */
export function pbsUrl(target: RuntimeTarget, mirror?: string): string {
	const base = (mirror?.trim() || PBS_BASE).replace(/\/+$/, "")
	return `${base}/${encodeURIComponent(pbsAsset(target))}`
}

/**
 * The folder name of one build. Short on purpose: the deepest file of the Windows packages sits about 120 characters
 * below it, and Python on Windows cannot import past 260 characters unless long paths are switched on.
 */
export function runtimeId(target: RuntimeTarget): string {
	return `py${CPYTHON.split(".").slice(0, 2).join("")}-${target}-r${RUNTIME_REVISION}`
}

export function backendFor(platform: NodeJS.Platform = process.platform): BluetoothBackend {
	return platform === "win32" ? "winrt" : platform === "darwin" ? "corebluetooth" : "bluezdbus"
}

/** The interpreter inside an unpacked portable Python (`<root>/python/...`). */
export function interpreterInPortable(
	root: string,
	platform: NodeJS.Platform = process.platform,
	sep = pathSep(platform),
): string {
	return platform === "win32" ? [root, "python", "python.exe"].join(sep) : [root, "python", "bin", "python3"].join(sep)
}

/** The interpreter inside a virtual environment made with `python -m venv <root>`. */
export function interpreterInVenv(root: string, platform: NodeJS.Platform = process.platform, sep = pathSep(platform)): string {
	return platform === "win32" ? [root, "Scripts", "python.exe"].join(sep) : [root, "bin", "python"].join(sep)
}

function pathSep(platform: NodeJS.Platform): string {
	return platform === "win32" ? "\\" : "/"
}

/**
 * What the gateway service tool imports, pinned to the versions it was proven with (10 to 12 Oct 2026). pip resolves
 * the rest from these packages' own metadata, for the system it runs on: winrt-* (and typing_extensions) on Windows,
 * pyobjc-* on macOS, dbus-fast on Linux. cryptography 49 and later publish no Intel-Mac wheel.
 */
export const REQUIREMENTS = [
	"bleak==3.0.2",
	"pyserial==3.5",
	'cryptography==50.0.2 ; sys_platform != "darwin" or platform_machine != "x86_64"',
	'cryptography==48.0.1 ; sys_platform == "darwin" and platform_machine == "x86_64"',
].join("\n")

/**
 * The versions of the dependencies the published packages were proven with. A constraint only applies to a package
 * something requires, so one file serves every system. If pip cannot satisfy them (a system with no wheel at that
 * version), the setup tries once more with the requirements alone.
 */
export const CONSTRAINTS = [
	"typing-extensions==4.16.0",
	"cffi==2.1.1",
	"pycparser==2.23",
	"winrt-runtime==3.2.1",
	"winrt-Windows.Devices.Bluetooth==3.2.1",
	"winrt-Windows.Devices.Bluetooth.Advertisement==3.2.1",
	"winrt-Windows.Devices.Bluetooth.GenericAttributeProfile==3.2.1",
	"winrt-Windows.Devices.Enumeration==3.2.1",
	"winrt-Windows.Devices.Radios==3.2.1",
	"winrt-Windows.Foundation==3.2.1",
	"winrt-Windows.Foundation.Collections==3.2.1",
	"winrt-Windows.Storage.Streams==3.2.1",
	"pyobjc-core==12.2.2",
	"pyobjc-framework-Cocoa==12.2.2",
	"pyobjc-framework-CoreBluetooth==12.2.2",
	"pyobjc-framework-libdispatch==12.2.2",
	"dbus-fast==5.2.0",
].join("\n")

/**
 * The health check: exactly what a scan needs. bleak loads its system part only at the first scan, so the check names
 * it; importing bleak alone passed on the broken 0.5.1 Windows package. Prints one JSON line.
 */
export function healthCheckCode(platform: NodeJS.Platform = process.platform): string {
	const backend = backendFor(platform)
	return [
		"import json, sys",
		'r = {"python": sys.version.split()[0], "exe": sys.executable}',
		"try:",
		"    import importlib.metadata as m",
		`    import bleak, bleak.backends.${backend}.scanner, bleak.backends.${backend}.client, cryptography, serial`,
		'    r["bleak"] = m.version("bleak")',
		'    r["ok"] = sys.version_info >= (3, 10) and int(r["bleak"].split(".")[0]) >= 1',
		'    if not r["ok"]: r["error"] = "Python " + r["python"] + " with bleak " + r["bleak"] + " is too old"',
		"except BaseException as e:",
		'    r["ok"] = False',
		'    r["error"] = type(e).__name__ + ": " + str(e)',
		"print(json.dumps(r))",
	].join("\n")
}

/** The probe a system Python must pass to be a base for a private environment (Python 3.10 to 3.13, venv present). */
export const PROBE_CODE = [
	"import json, sys",
	'r = {"v": sys.version_info[0] * 100 + sys.version_info[1], "exe": sys.executable}',
	"try:",
	"    import venv, ensurepip",
	'    r["venv"] = True',
	"except Exception:",
	'    r["venv"] = False',
	"print(json.dumps(r))",
].join("\n")

export const MIN_SYSTEM_PY = 310
export const MAX_SYSTEM_PY = 313

/** One way to start a Python: a command and its leading arguments (`py -3.12`). */
export type PythonCommand = { cmd: string; args: string[] }

/**
 * Pythons that may already be on this computer, best first. Wildcards (`*`) in a path are expanded by the caller,
 * one folder level each. Commands without a folder are looked up on PATH. The Microsoft Store's python.exe stub is
 * on PATH on a fresh Windows, so every candidate is RUN by the probe, never trusted by name.
 */
export function systemPythonCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): PythonCommand[] {
	const c = (cmd: string, ...args: string[]): PythonCommand => ({ cmd, args })
	if (platform === "win32") {
		const local = env.LOCALAPPDATA || `${home}\\AppData\\Local`
		const programs = env.ProgramFiles || "C:\\Program Files"
		const minors = ["13", "12", "11", "10"]
		return [
			...minors.map((m) => c("py", `-3.${m}`)),
			c("python"),
			c("python3"),
			...minors.map((m) => c(`${local}\\Programs\\Python\\Python3${m}\\python.exe`)),
			...minors.map((m) => c(`${programs}\\Python3${m}\\python.exe`)),
			c("C:\\ncs\\toolchains\\*\\opt\\bin\\python.exe"),
			c("C:\\Espressif\\tools\\idf-python\\*\\python.exe"),
			c(`${home}\\.espressif\\tools\\idf-python\\*\\python.exe`),
		]
	}
	const minors = ["3.13", "3.12", "3.11", "3.10"]
	const common = [...minors.map((m) => c(`python${m}`)), c("python3")]
	if (platform === "darwin") {
		return [
			...common,
			c("/opt/homebrew/bin/python3"),
			c("/usr/local/bin/python3"),
			...minors.map((m) => c(`/Library/Frameworks/Python.framework/Versions/${m}/bin/python3`)),
			c("/opt/nordic/ncs/toolchains/*/bin/python3"),
		]
	}
	return [...common, c("/usr/bin/python3"), c(`${home}/ncs/toolchains/*/usr/local/bin/python3`)]
}

/** True when a tool's words say a Python module is missing or broken: the sign that the setup needs a repair. */
export function looksLikeMissingModule(text: string | undefined): boolean {
	return !!text && /No module named|ModuleNotFoundError|ImportError|DLL load failed|cannot import name/i.test(text)
}
