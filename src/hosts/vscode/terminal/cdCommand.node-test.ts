import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { cdCommandFor } from "./VscodeTerminalManager"

/**
 * Moving a shell to a directory, in three operating systems' worth of dialects.
 *
 * `cd "path"` was hard-coded, and it is wrong in one case that fails SILENTLY: on Windows `cmd.exe` it
 * changes directory but not drive, so from C: a `cd "D:\\work"` leaves the shell on C: with no error and
 * every relative path afterwards resolves in the wrong tree. PowerShell needs `-LiteralPath` for the
 * separate reason that `[` and `]` in a path are wildcard syntax to it, and bracketed folder names are
 * ordinary on Windows.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/hosts/vscode/terminal/cdCommand.node-test.ts
 */
describe("cdCommandFor", () => {
	test("POSIX shells get a plain quoted cd", () => {
		for (const shell of ["/bin/bash", "/bin/zsh", "/usr/bin/fish", "/bin/sh"]) {
			assert.equal(cdCommandFor(shell, "/home/dev/project"), 'cd "/home/dev/project"')
		}
	})

	test("cmd.exe gets /d so the DRIVE changes too", () => {
		for (const shell of ["C:\\Windows\\System32\\cmd.exe", "cmd.exe", "cmd"]) {
			assert.equal(cdCommandFor(shell, "D:\\work\\project"), 'cd /d "D:\\work\\project"')
		}
	})

	test("PowerShell gets Set-Location -LiteralPath, so brackets are not wildcards", () => {
		for (const shell of ["powershell.exe", "C:\\Program Files\\PowerShell\\7\\pwsh.exe", "pwsh"]) {
			assert.equal(cdCommandFor(shell, "C:\\src\\my [wip] app"), 'Set-Location -LiteralPath "C:\\src\\my [wip] app"')
		}
	})

	test("an unknown or absent profile falls back to the POSIX form rather than guessing", () => {
		assert.equal(cdCommandFor(undefined, "/tmp/x"), 'cd "/tmp/x"')
		assert.equal(cdCommandFor("", "/tmp/x"), 'cd "/tmp/x"')
		assert.equal(cdCommandFor("/opt/homebrew/bin/nu", "/tmp/x"), 'cd "/tmp/x"')
	})

	test("a path with spaces stays quoted in every dialect", () => {
		assert.match(cdCommandFor("/bin/bash", "/Users/me/My Project"), /"\/Users\/me\/My Project"$/)
		assert.match(cdCommandFor("cmd.exe", "C:\\My Project"), /^cd \/d "C:\\My Project"$/)
		assert.match(cdCommandFor("pwsh", "C:\\My Project"), /-LiteralPath "C:\\My Project"$/)
	})
})
