import path from "node:path"

/**
 * How a tool bit's entry point is actually executed.
 *
 * A bundle may ship its own launcher — a POSIX shell script named after the tool plus a `.bat`
 * sibling — and when it does we use it, because those wrappers already carry hard-won behaviour
 * (the Microsoft Store `python3` alias is a stub that prints "Python was not found" and exits 49,
 * so the wrappers probe by RUNNING each candidate; they also set PYTHONNOUSERSITE=1 to isolate from
 * user-site .pth conflicts). Anything without a launcher gets one generated from `runtime` + `entry`.
 */
export type ToolRuntime = "python3" | "node" | "wasm" | "native"

/** The platform-appropriate launcher filename for a tool, by convention: the tool's own name. */
export function launcherName(toolName: string, platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? `${toolName}.bat` : toolName
}

/**
 * Build the command prefix that runs a tool: the executable plus any leading arguments, before the
 * tool's own flags. Returned unquoted — callers quote for their own context.
 */
export function commandPrefix(args: {
	runtime: ToolRuntime
	/** Absolute path to the shipped launcher, when the bundle has one. */
	launcherPath?: string
	/** Absolute path to the entry file inside the bundle. */
	entryPath: string
	/** Interpreter resolved by the probe, for `python3`. */
	interpreter?: string
	/** VS Code's own Node — `process.execPath`. Needs nothing installed. */
	nodePath?: string
}): string[] {
	if (args.launcherPath) {
		return [args.launcherPath]
	}
	switch (args.runtime) {
		case "node":
		case "wasm":
			// wasm modules are instantiated by a small JS entry; both run under the editor's Node, which
			// is why they are the default for new tools — nothing for the developer to install.
			return [args.nodePath ?? process.execPath, args.entryPath]
		case "python3":
			return [args.interpreter ?? "python3", args.entryPath]
		case "native":
			return [args.entryPath]
	}
}

/** Quote a path for a shell command line when it contains spaces. */
export const quoteIfNeeded = (s: string): string => (s.includes(" ") ? `"${s}"` : s)

/**
 * Render a command prefix as a shell-ready string, shortened to a workspace-relative path when that
 * is both shorter and does not climb out of the workspace — the terminal output stays readable.
 */
export function renderCommand(prefix: string[], cwd?: string): string {
	return prefix
		.map((part, i) => {
			if (i > 0 || !cwd || !path.isAbsolute(part)) {
				return quoteIfNeeded(part)
			}
			try {
				const rel = path.relative(cwd, part)
				if (!rel.startsWith("..") && rel.length < part.length) {
					return quoteIfNeeded(process.platform === "win32" ? rel : `./${rel}`)
				}
			} catch {
				// keep absolute
			}
			return quoteIfNeeded(part)
		})
		.join(" ")
}
