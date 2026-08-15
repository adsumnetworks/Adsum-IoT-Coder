// Hardware-in-the-loop (HIL) test for the sniffer capture + decode rail. Drives the SAME wrapper script
// and decode rail TriggerNordicActionHandler.handleSniff() drives in production — never raw nrfutil — then
// asserts basic invariants on the real output. Hardware-gated by design: skips cleanly (exit 0) when the
// dongle isn't configured, so it cannot run in CI. See
// Adsum-Planning/operations/hardware-in-the-loop-testing.md for the full method.
//
// Usage:
//   npm run test:hil
//   HIL_SNIFFER_PORT=/dev/ttyACM0 HIL_FOLLOW_NAME="MyDevice" npm run test:hil   (COM7 on Windows)
//
// We never auto-pick a serial port as "the dongle" — guessing wrong could capture against the wrong
// device. HIL_SNIFFER_PORT must be set explicitly; its absence is treated as "no hardware configured".

import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resolveNrfutilCommands } from "../src/services/nrf/EnvironmentDetector"
import { decodeSnifferPcap } from "../src/services/nrf/sniffer/format"

function skip(reason: string): never {
	console.log(`[test:hil] SKIP — ${reason}`)
	process.exit(0)
}

/**
 * Find nrfutil the way the PRODUCT finds it, not the way a shell would.
 *
 * A bare `execFileSync("nrfutil", …)` only sees PATH. On Windows — where ~95% of users are — the
 * standalone installer puts the launcher in `%USERPROFILE%\.nrfutil\bin` and does NOT add it to PATH,
 * and the nRF Connect extension ships its own copy elsewhere entirely. So this harness reported
 * "no hardware configured" and exited 0 on a machine with a board plugged in and nrfutil installed —
 * a green run that had tested nothing. Reuse the resolver the extension itself uses, so the harness
 * skips only when nrfutil is genuinely absent.
 */
function findNrfutil(): string | undefined {
	const { devicePrefix } = resolveNrfutilCommands({})
	// devicePrefix is shell-quoted and ends in the subcommand word ("… device"); strip both.
	const m = devicePrefix.match(/^"?(.+?)"?\s+device$/)
	const bin = m ? m[1] : devicePrefix.replace(/^"|"$/g, "")
	try {
		execFileSync(bin, ["--version"], { stdio: "ignore" })
		return bin
	} catch {
		return undefined
	}
}

function main() {
	if (!findNrfutil()) {
		skip(
			"nrfutil not found (checked PATH, ~/.nrfutil/bin, and the nRF Connect extension's bundled " +
				"copy) — install it or run on a box with the sniffer dongle attached.",
		)
	}

	const port = process.env.HIL_SNIFFER_PORT
	if (!port) {
		skip(
			"HIL_SNIFFER_PORT not set — plug in the sniffer dongle and re-run with " +
				"HIL_SNIFFER_PORT=<port> (e.g. /dev/ttyACM0 or COM7) set. See " +
				"Adsum-Planning/operations/hardware-in-the-loop-testing.md.",
		)
	}

	const followName = process.env.HIL_FOLLOW_NAME
	const isWindows = process.platform === "win32"
	const wrapperName = isWindows ? "nrf-sniffer.bat" : "nrf-sniffer"
	const wrapperPath = path.join(__dirname, "..", "assets", "scripts", wrapperName)
	if (!fs.existsSync(wrapperPath)) {
		console.error(`[test:hil] FAIL — wrapper script not found: ${wrapperPath}`)
		process.exit(1)
	}

	const outPcap = path.join(os.tmpdir(), `hil-test-${Date.now()}.pcap`)
	const args = ["--port", port, "--output", outPcap, "--duration", "10"]
	if (followName) {
		args.push("--follow-name", followName)
	}

	console.log(`[test:hil] capturing via ${wrapperPath} ${args.join(" ")}`)
	const capture = spawnSync(isWindows ? "cmd.exe" : wrapperPath, isWindows ? ["/c", wrapperPath, ...args] : args, {
		stdio: "inherit",
		timeout: 30_000,
	})
	if (capture.status !== 0) {
		console.error(`[test:hil] FAIL — capture wrapper exited with status ${capture.status}`)
		process.exit(1)
	}
	if (!fs.existsSync(outPcap)) {
		console.error(`[test:hil] FAIL — capture wrapper reported success but no pcap at ${outPcap}`)
		process.exit(1)
	}

	const buf = fs.readFileSync(outPcap)
	const { text, result } = decodeSnifferPcap(buf)

	const failures: string[] = []
	if (result.linkType === undefined) {
		failures.push("no pcap link-type decoded — is this a valid pcap?")
	}
	if (!text.includes("Proto")) {
		failures.push("decoded text is missing the expected column header (Proto)")
	}
	if (result.totalFrames > 0 && !text.includes("sequenceDiagram")) {
		failures.push("frames were decoded but no mermaid sequenceDiagram footer was emitted")
	}

	console.log(
		`[test:hil] decoded ${result.totalFrames} frame(s), ${result.parseErrors} parse error(s), ` +
			`linkType=${result.linkType}`,
	)

	if (failures.length > 0) {
		console.error(`[test:hil] FAIL —\n  - ${failures.join("\n  - ")}`)
		process.exit(1)
	}

	console.log(`[test:hil] PASS — raw capture: ${outPcap}`)
}

main()
