import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { checkCommandGuards, rejectAdsumShellWrite, rejectRawNrfToolCommand } from "./commandGuards"

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
