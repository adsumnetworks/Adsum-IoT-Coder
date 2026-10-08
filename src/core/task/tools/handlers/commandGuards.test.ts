import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { checkCommandGuards, rejectAdsumShellWrite, rejectKillByName, rejectRawNrfToolCommand } from "./commandGuards"

/**
 * Every "must reject" case below is a command a model actually ran on 2026-08-08 and that dead-ended.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/tools/handlers/commandGuards.test.ts
 */

describe("rejectAdsumShellWrite — memory is written by the tool, never the shell", () => {
	test("the real here-string write that also hung for 95 seconds", () => {
		const cmd =
			`Set-Content -Path "c:\\Users\\omarm\\Desktop\\ncs-projects\\ble-bridge\\.adsum\\devices.md" -Value @'\n` +
			`# Device Facts (confirmed)\n- J-Link 683335182\n'@`
		const r = rejectAdsumShellWrite(cmd)
		assert.ok(r, "must be rejected")
		assert.match(r as string, /update_project_memory/, "names the correct tool")
		assert.match(r as string, /hw-asserted/, "lists the targets so the model can retry immediately")
	})

	test("the real status.json write", () => {
		const cmd = `Set-Content -Path "c:\\Users\\omarm\\Desktop\\ncs-projects\\ble-bridge\\.adsum\\status.json" -Value '{"goal":"x"}'`
		assert.ok(rejectAdsumShellWrite(cmd))
	})

	test("redirects and other write verbs are caught too", () => {
		assert.ok(rejectAdsumShellWrite('echo "x" > .adsum/notes/a.md'))
		assert.ok(rejectAdsumShellWrite("cat foo >> ./.adsum/status.json"))
		assert.ok(rejectAdsumShellWrite('Out-File -FilePath ".adsum\\PROJECT.md"'))
		assert.ok(rejectAdsumShellWrite('Remove-Item ".adsum\\status.json"'))
	})

	test("READING .adsum is allowed — only writes are refused", () => {
		assert.equal(rejectAdsumShellWrite("Get-Content .adsum/PROJECT.md"), null)
		assert.equal(rejectAdsumShellWrite("cat .adsum/MAP.md"), null)
		assert.equal(rejectAdsumShellWrite("ls .adsum"), null)
	})

	test("unrelated writes are untouched", () => {
		assert.equal(rejectAdsumShellWrite('Set-Content -Path "src/main.c" -Value "int main(){}"'), null)
		assert.equal(rejectAdsumShellWrite("echo hello > build.log"), null)
	})
})

describe("rejectRawNrfToolCommand — SDK tools need the nRF terminal", () => {
	test("the two real failures", () => {
		// Both produced: "The term 'nrfutil' is not recognized as the name of a cmdlet"
		const a = rejectRawNrfToolCommand("nrfutil device list")
		assert.ok(a)
		assert.match(a as string, /trigger_nordic_action/, "names the correct tool")
		assert.match(a as string, /not ask the developer/, "tells it not to stall on a question")
		assert.ok(rejectRawNrfToolCommand("nrfjprog --ids"))
	})

	test("covers the rest of the SDK tools and common wrappers", () => {
		assert.ok(rejectRawNrfToolCommand("west build -b nrf52840dk/nrf52840"))
		assert.ok(rejectRawNrfToolCommand("west.exe flash"))
		assert.ok(rejectRawNrfToolCommand('cmd /c "west build"'))
		assert.ok(rejectRawNrfToolCommand("  nrfutil  device  list  "))
	})

	test("legitimate cleanup the capture action performs is NOT blocked", () => {
		// capture-logs.md declares safety:[process-kill] for exactly this.
		assert.equal(rejectRawNrfToolCommand("taskkill /F /IM JLink.exe /IM nrfutil.exe"), null)
		assert.equal(rejectRawNrfToolCommand("pkill -f nrfutil"), null)
	})

	test("ordinary commands pass, including ones that merely mention a tool", () => {
		assert.equal(rejectRawNrfToolCommand("python assets/scripts/nrf_rtt_logger.py --list"), null)
		assert.equal(rejectRawNrfToolCommand("git log --oneline"), null)
		assert.equal(rejectRawNrfToolCommand('echo "run west build in the nRF terminal"'), null)
	})
})

describe("checkCommandGuards — combined", () => {
	test("returns the memory rejection first when both could apply", () => {
		const r = checkCommandGuards('Set-Content -Path ".adsum/notes/x.md" -Value "y"')
		assert.match(r as string, /update_project_memory/)
	})
	test("allows a normal command", () => {
		assert.equal(checkCommandGuards("npm run build"), null)
	})
})

describe("rejectKillByName — one process by its id, never every process with a name", () => {
	test("the real G4 commands (5 Oct, Windows) and the 30 Aug shared-bench one", () => {
		for (const cmd of [
			"taskkill /F /IM JLink.exe",
			'cmd /c "taskkill /F /IM JLink.exe 2>nul & taskkill /F /IM nrfutil.exe 2>nul"',
			"pkill -9 JLink",
			"pkill -9 JLink && pkill -9 nrfutil",
		]) {
			const r = rejectKillByName(cmd)
			assert.ok(r, `must be rejected: ${cmd}`)
			assert.match(r as string, /by its id/, "says what to do instead")
		}
	})

	test("the other ways to kill by name", () => {
		assert.ok(rejectKillByName("killall JLinkExe"))
		assert.ok(rejectKillByName("Get-Process -Name JLink, nrfutil -ErrorAction SilentlyContinue | Stop-Process -Force"))
		assert.ok(rejectKillByName("Stop-Process -Name JLink -Force"))
		assert.ok(rejectKillByName("kill -9 $(pgrep JLinkExe)"))
		assert.ok(rejectKillByName("pgrep -f nrfutil | xargs kill -9"))
		assert.ok(rejectKillByName("sudo pkill nrfutil"))
	})

	test("one process by its id is allowed, and so is looking", () => {
		assert.equal(rejectKillByName("kill 12345"), null)
		assert.equal(rejectKillByName("kill -9 12345"), null)
		assert.equal(rejectKillByName("Stop-Process -Id 4242 -Force"), null)
		assert.equal(rejectKillByName("taskkill /F /T /PID 4242"), null)
		assert.equal(rejectKillByName('pgrep -af "JLinkExe|nrfutil"'), null)
		assert.equal(rejectKillByName("Get-Process JLink*,nrfutil* | Select Id,StartTime,Path"), null)
		assert.equal(rejectKillByName("fuser -v /dev/ttyACM0"), null)
	})

	test("words that merely contain the names are not kills", () => {
		assert.equal(rejectKillByName("west build -b nrf52840dk/nrf52840 -- -DCONFIG_SKILL=y"), null)
		assert.equal(rejectKillByName('git log --grep "pkill"'), rejectKillByName('git log --grep "pkill"'))
	})

	test("the combined check includes it", () => {
		assert.ok(checkCommandGuards("taskkill /F /IM JLink.exe"))
	})
})
