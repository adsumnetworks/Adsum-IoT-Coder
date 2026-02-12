import { spawnSync } from "node:child_process"

/**
 * Detect an available Python 3 executable on the system.
 * Tries `python3`, `python`, then the Windows launcher `py -3`.
 * Returns the command name/path to use (e.g. 'python3' or 'C:\\Python39\\python.exe')
 * or null if none were found.
 */
export async function detectPython(): Promise<string | null> {
	const candidates = ["python3", "python", "py"]

	for (const cmd of candidates) {
		try {
			if (cmd === "py") {
				// Windows py needs '-3' to request Python 3
				const res = spawnSync(cmd, ["-3", "--version"], { encoding: "utf8" })
				if (res.status === 0 && /Python 3/.test(res.stdout + res.stderr)) return cmd + " -3"
			} else {
				const res = spawnSync(cmd, ["--version"], { encoding: "utf8" })
				if (res.status === 0 && /Python 3/.test(res.stdout + res.stderr)) return cmd
			}
		} catch (e) {
			// ignore and try next
		}
	}

	return null
}

export default detectPython
