/**
 * Guards on what a raw shell command is allowed to do.
 *
 * Both rules here exist because a model did the wrong thing in a real session and doctrine alone did
 * not stop it. Prompt text sets the default behaviour; these guards make the failure impossible and,
 * more usefully, tell the model exactly what to do instead.
 */

/** Result of a guard check: `null` means allowed. */
export type CommandRejection = string | null

/**
 * Writes into `.adsum/` (project memory) must go through `update_project_memory`.
 *
 * Observed 2026-08-08: the agent wrote memory with PowerShell `Set-Content ... -Value @' ... '@`
 * here-strings, inventing its own file layout (`.adsum/devices.md`, `.adsum/status.json`) that the
 * memory system does not read. Three separate harms:
 *   1. It bypasses validation and the size caps, so memory can grow without bound.
 *   2. It races the host, which owns several of those files.
 *   3. One of those here-strings HUNG for 95 seconds and the task had to be resumed — multi-line
 *      quoted commands are exactly what the terminal's output capture handles worst.
 * The immediate cause was a stale knowledge rule naming files that no longer exist, now fixed; this
 * guard is the backstop so a future stale instruction cannot reintroduce it.
 */
export function rejectAdsumShellWrite(command: string): CommandRejection {
	const c = command.replace(/\s+/g, " ")
	// Only care about commands that both touch .adsum AND look like a write.
	if (!/[.\\/]adsum[\\/]/i.test(c) && !/\.adsum\b/i.test(c)) {
		return null
	}
	const writes =
		/\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|tee|truncate)\b/i.test(c) ||
		/(^|[^>])>>?[^>]/.test(c) ||
		/\b(echo|cat|printf)\b[^|]*>/i.test(c)
	if (!writes) {
		return null
	}
	return (
		"Refused: `.adsum/` is managed project memory and must not be written with shell commands.\n\n" +
		"Use the `update_project_memory` tool instead — it writes silently, enforces the size caps, and " +
		"keeps the host-detected sections intact. Pick a target:\n" +
		"  • `defect` — a bug you are working (requires a path:line or logpath:line-range citation)\n" +
		"  • `goal` — the project objective (only when the developer states or changes it)\n" +
		"  • `hw-asserted` — bench facts only the developer knows (jumpers, board mode)\n" +
		"  • `note` — a topic write-up worth keeping\n\n" +
		"Board, ports, serials, SDK versions, the app list and the file map are detected and written " +
		"automatically — you never need to record those. Reading `.adsum/` files is fine."
	)
}

/**
 * nRF SDK tools must run through `trigger_nordic_action`, not a plain shell.
 *
 * The nRF Connect terminal is the only place where the NCS environment is sourced. Observed twice on
 * 2026-08-08: the agent ran `nrfutil device list` and `nrfjprog --ids` through `execute_command` and
 * both died with "The term 'nrfutil' is not recognized as the name of a cmdlet" — a dead end that cost
 * one abandoned task, because the model then asked the user to re-confirm the board instead of simply
 * switching tools.
 *
 * Deliberately narrow: only the SDK executables, and only when they open the command. Anything else
 * passes through untouched (a kill by name is refused by its own guard, below).
 */
const NRF_TOOLS = ["nrfutil", "nrfjprog", "west", "mergehex", "nrfdl"] as const

export function rejectRawNrfToolCommand(command: string): CommandRejection {
	// Peel the common wrappers, then any quoting. `cmd /c "west build"` must resolve to `west`, or the
	// quote itself becomes the first token and the guard silently passes.
	let head = command.trim()
	for (let i = 0; i < 3; i++) {
		const peeled = head
			.replace(
				/^(?:cmd(?:\.exe)?\s+\/c\s+|powershell(?:\.exe)?\s+(?:-\w+\s+)*|pwsh\s+-\w+\s+|sh\s+-c\s+|bash\s+-c\s+)/i,
				"",
			)
			.replace(/^["']/, "")
		if (peeled === head) {
			break
		}
		head = peeled.trim()
	}
	const first = head
		.split(/[\s;&|"']/)[0]
		.replace(/^.*[\\/]/, "")
		.replace(/\.(exe|cmd|bat)$/i, "")
		.toLowerCase()
	if (!NRF_TOOLS.includes(first as (typeof NRF_TOOLS)[number])) {
		return null
	}
	return (
		`Refused: \`${first}\` must run in the nRF Connect terminal, not a plain shell.\n\n` +
		'A plain shell has no NCS environment, so this fails with "the term is not recognized" even ' +
		'though the tool is installed. Use `trigger_nordic_action` with `action: "execute"` and put the ' +
		"same command in its `command` parameter — it runs in the correct environment.\n\n" +
		"Do not ask the developer to confirm anything about this; just re-issue through the right tool."
	)
}

/**
 * Ending processes by NAME is refused; ending one process by its id is not.
 *
 * Observed 2026-10-05 (the first BLG20 run on Windows, finding G4): the agent ran `taskkill /F /IM JLink.exe`
 * and the same for nrfutil. On 2026-08-30 two agents reached for `pkill -9 JLink` within a day on a shared
 * bench. A name match ends every probe session on the machine: another engineer's, the nRF Connect apps, a
 * capture another task is running, and with them the evidence of why the probe was busy. The device tool's
 * own description used to tell the model to do it before every flash; that text is gone and this guard is
 * the backstop for anything that still suggests it.
 */
const KILL_BY_NAME: RegExp[] = [
	/(^|[\s;&|(`"'])(pkill|killall)(\.exe)?\b/i,
	/\btaskkill(\.exe)?\b[^&|;]*\/IM\b/i,
	/\bStop-Process\b[^|;]*-(Name|ProcessName)\b/i,
	/\bGet-Process\b[^|;]*\|\s*(Stop-Process|kill)\b/i,
	/\bkill\b[^;&|]*(\$\(|`)\s*(pgrep|pidof)\b/i,
	/\b(pgrep|pidof)\b[^;]*\|\s*xargs\s+(-\S+\s+)*kill\b/i,
	/\bwmic\b[^&|;]*\bwhere\b[^&|;]*name[^&|;]*\b(delete|terminate)\b/i,
]

export function rejectKillByName(command: string): CommandRejection {
	const c = command.replace(/\s+/g, " ")
	if (!KILL_BY_NAME.some((re) => re.test(c))) {
		return null
	}
	return (
		"Refused: ending processes by name (pkill, killall, taskkill /IM, Stop-Process -Name) also ends the " +
		"developer's other sessions - another J-Link, the nRF Connect apps, a capture another task is running.\n\n" +
		'If a probe or a port is busy: list what holds it (Linux/macOS `pgrep -af "JLinkExe|JLinkGDBServer|nrfutil"` ' +
		"or `fuser -v /dev/ttyACM0`; Windows `Get-Process JLink*,nrfutil* | Select Id,StartTime,Path`), tell the " +
		"developer which program holds it, and end that one process by its id (`kill <pid>`, `Stop-Process -Id <id>`, " +
		"`taskkill /PID <id>`) only after they agree - or ask them to close it."
	)
}

/** All command guards, in order. Returns the first rejection, or null when the command is allowed. */
export function checkCommandGuards(command: string): CommandRejection {
	return rejectAdsumShellWrite(command) ?? rejectRawNrfToolCommand(command) ?? rejectKillByName(command)
}
