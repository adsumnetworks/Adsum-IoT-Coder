/**
 * Hardware-in-the-loop check for an nRF91 cellular DK — designed so that FAILING TO CONNECT IS A PASS.
 *
 * Why it works that way. Omar is in Algeria with the trial SIM that shipped with an nRF9161 DK. That SIM
 * very likely has no roaming agreement there, so the device will never attach. Waiting for a successful
 * connection before we can test anything would block all cellular work on a teammate in another country.
 *
 * But "it did not connect" is not a dead end — it is the single most common thing a real developer
 * experiences, and the thing the agent most needs to get right. So this harness does not ask
 * "did it connect?". It asks:
 *
 *     Did the modem tell us WHY, and is that reason one we can explain in plain language?
 *
 * A run that ends in "registration denied, EMM cause 15" is a full pass: the hardware works, the tooling
 * works, and we have a real failure to check the agent's explanation against.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json scripts/hil-cellular.ts
 * Skips cleanly (exit 0) when no nRF91 board is attached, so it is safe in CI.
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// ── the modem's own answers, in plain language ──────────────────────────────────

/** `+CEREG?` registration status → what it means for the developer. Verified against Nordic docs. */
const CEREG_STATUS: Record<string, { short: string; plain: string; pass: boolean }> = {
	"0": {
		short: "not registered, not searching",
		plain: "The modem is idle and not even looking for a network. Usually CFUN is not 1.",
		pass: false,
	},
	"1": { short: "registered (home)", plain: "Connected to its home network.", pass: true },
	"2": {
		short: "searching",
		plain: "Looking for a network. Normal for the first ~30 seconds. If it stays here, there is no network this SIM may use.",
		pass: true, // an honest, explainable outcome
	},
	"3": {
		short: "registration DENIED",
		plain: "A network was found and refused the SIM. Usually the SIM is not activated, has no roaming agreement here, or the APN is wrong.",
		pass: true,
	},
	"4": { short: "unknown / out of coverage", plain: "No usable signal.", pass: true },
	"5": { short: "registered (roaming)", plain: "Connected via a roaming partner. This is success.", pass: true },
	"90": {
		short: "SIM failure",
		plain: "The modem cannot read a SIM at all. Missing, upside down, or dead.",
		pass: true,
	},
	"91": {
		short: "no cell for the selected system mode",
		plain: "There is coverage, but not in the mode selected with %XSYSTEMMODE. Try the other of LTE-M / NB-IoT.",
		pass: true,
	},
}

/** Access technology, as reported by +CEREG / +COPS. 14 is the one that proves satellite. */
const ACCESS_TECH: Record<string, string> = { "7": "LTE-M", "9": "NB-IoT", "14": "NTN NB-IoT (satellite)" }

// ── device discovery ────────────────────────────────────────────────────────────

interface Board {
	serial: string
	port?: string
	product?: string
	/** From `devkit` in the list JSON, e.g. "PCA10153" — the ONLY place the board identity appears. */
	boardVersion?: string
	/** From `devkit`, e.g. "NRF91_FAMILY" — what actually identifies a cellular part. */
	deviceFamily?: string
}

function nrfutil(): string {
	const candidates = [
		path.join(os.homedir(), ".nrfutil", "bin", "nrfutil.exe"),
		path.join(os.homedir(), ".nrfutil", "bin", "nrfutil"),
		"nrfutil",
	]
	return candidates.find((c) => c === "nrfutil" || fs.existsSync(c)) ?? "nrfutil"
}

/** Every attached board nrfutil can see. Returns [] rather than throwing when nrfutil is absent. */
function listBoards(): Board[] {
	try {
		const out = execFileSync(nrfutil(), ["device", "list", "--json"], { encoding: "utf8", timeout: 60_000 })
		const boards: Board[] = []
		for (const line of out.split("\n")) {
			if (!line.trim().startsWith("{")) {
				continue
			}
			try {
				const devices = JSON.parse(line)?.data?.data?.devices
				if (!Array.isArray(devices)) {
					continue
				}
				for (const d of devices) {
					boards.push({
						serial: d.serialNumber,
						port: d.serialPorts?.[0]?.comName,
						product: d.usb?.product,
						// `usb.product` is "J-Link" for EVERY Nordic DK — the board identity lives here.
						boardVersion: d.devkit?.boardVersion,
						deviceFamily: d.devkit?.deviceFamily,
					})
				}
			} catch {
				// not the line we wanted
			}
		}
		return boards
	} catch {
		return []
	}
}

/** The nRF91 cellular DKs, by board code — `devkit.boardVersion` in the list JSON. */
const NRF91_BOARDS = new Set(["PCA10090", "PCA10153", "PCA10171"]) // nRF9160 DK, nRF9161 DK, nRF9151 DK

/**
 * True when this board is an nRF91 cellular part.
 *
 * This used to match only on `usb.product` and the serial — but nrfutil reports `product: "J-Link"` for
 * EVERY Nordic DK, and a serial carries no model. So the check could never fire on a real board: an
 * nRF9161 DK sat plugged into the bench and this test reported "none of them nRF91" and skipped. The
 * cellular HIL gate had therefore never once executed against hardware.
 *
 * `devkit.deviceFamily` ("NRF91_FAMILY") is in the same JSON the parser already reads, one key away.
 * The board-code set is the belt-and-braces path for firmware that reports a version but no family, and
 * the old string match is kept last so a future non-DK part named "nRF9151" still matches.
 */
function isNrf91(b: Board): boolean {
	if (b.deviceFamily?.toUpperCase().includes("NRF91")) {
		return true
	}
	if (b.boardVersion && NRF91_BOARDS.has(b.boardVersion.toUpperCase())) {
		return true
	}
	return /nrf91|9160|9161|9151/i.test(`${b.product ?? ""} ${b.serial}`)
}

// ── reporting ───────────────────────────────────────────────────────────────────

const line = (s = "") => console.log(s)

function report(cereg: string | undefined, csq: string | undefined, iccid: string | undefined): number {
	line()
	line("─".repeat(72))
	line("WHAT THE MODEM SAID")
	line("─".repeat(72))

	if (!cereg) {
		line("  +CEREG?      no answer — the modem did not respond at all.")
		line("               That is a tooling or wiring problem, not a network one.")
		return 1
	}

	// +CEREG: <n>,<stat>[,...]
	const parts = cereg.replace(/^\+CEREG:\s*/, "").split(",")
	const stat = parts[1]?.trim()
	const act = parts[4]?.trim()
	const info = stat ? CEREG_STATUS[stat] : undefined

	line(`  SIM (ICCID)  ${iccid ? iccid : "not readable — no SIM detected"}`)
	line(`  signal       ${csq === "99,99" ? "99,99  (no signal / unknown — not 'zero bars')" : (csq ?? "unknown")}`)
	line(`  +CEREG stat  ${stat ?? "?"}  ${info ? `— ${info.short}` : "— unrecognised"}`)
	if (act && ACCESS_TECH[act]) {
		line(`  access tech  ${act} = ${ACCESS_TECH[act]}`)
	}
	line()
	line("  In plain language:")
	line(`    ${info ? info.plain : "The modem returned a status this harness does not know about."}`)
	line()

	if (info?.pass) {
		line("  RESULT: PASS — the modem gave a clear, explainable answer.")
		line("  This is a usable test case even though the device is not online.")
		line()
		line("  Now check the AGENT against it. Ask it to diagnose the same board and see whether it:")
		line("    1. reads the modem state before touching any code")
		line("    2. names this same cause in plain language")
		line("    3. STOPS, instead of editing the app or retrying forever")
		return 0
	}
	line("  RESULT: FAIL — the modem is not in a state we can explain.")
	return 1
}

// ── main ────────────────────────────────────────────────────────────────────────

function main(): number {
	line("nRF91 cellular HIL check — a failed connection is a valid result")
	line()

	// Modem answers supplied → JUDGE them, whether or not a board is attached right now.
	// Capturing and judging are deliberately separable: the answers can be captured on the bench in one
	// country and read by whoever is diagnosing in another, which is the actual working arrangement here.
	const cereg = process.env.HIL_CEREG
	const csq = process.env.HIL_CSQ
	const iccid = process.env.HIL_ICCID
	if (cereg) {
		return report(cereg, csq, iccid)
	}

	const boards = listBoards()
	let cellular = boards.filter(isNrf91)
	const wanted = process.env.HIL_SERIAL?.trim()
	if (wanted) {
		const picked = cellular.filter((b) => b.serial === wanted || b.serial.endsWith(wanted))
		if (picked.length === 0) {
			line(
				`HIL_SERIAL=${wanted} matches no attached nRF91 board. Attached: ${cellular.map((b) => b.serial).join(", ") || "none"}`,
			)
			line("FAILING — a named board that is not there is a mistake, not a skip.")
			return 1
		}
		cellular = picked
	}

	if (boards.length === 0) {
		line("No boards found (nrfutil saw nothing). SKIPPING — nothing to test.")
		return 0
	}
	if (cellular.length === 0) {
		line(`Found ${boards.length} board(s), none of them nRF91:`)
		for (const b of boards) {
			line(`  ${b.serial}  ${b.product ?? ""}`)
		}
		line()
		line("SKIPPING — plug in an nRF9160 / nRF9161 / nRF9151 DK to run this.")
		return 0
	}

	// Report EVERY cellular board, not just the first. The bench runs two nRF9161 DKs and they report
	// the same boardVersion, so `cellular[0]` picked one and said nothing about the other — a silent
	// choice between identical-looking boards is exactly how the wrong one ends up under test.
	line(`Cellular board(s): ${cellular.length}`)
	for (const b of cellular) {
		line(`  ${b.serial}  ${b.boardVersion ?? b.deviceFamily ?? b.product ?? ""}  port ${b.port ?? "unknown"}`)
	}
	if (cellular.length > 1) {
		line()
		line("More than one — name the board you mean with HIL_SERIAL=<serial>, or the answers below")
		line("will be judged without any record of which modem produced them.")
	}
	line()
	line("This harness does NOT send AT commands by itself — the modem must be reachable")
	line("through a firmware that exposes them (the `at_client` sample, or an app with the")
	line("AT shell enabled). Flash one of those, then paste the answers below.")
	line()
	line("  AT+CFUN?      →  is the modem on")
	line("  AT%XICCID     →  is a SIM readable")
	line("  AT+CEREG?     →  registration status   ← the important one")
	line("  AT+CSQ        →  signal")
	line()

	line("No modem answers supplied. Re-run with them once you have flashed at_client:")
	line('  HIL_CEREG="+CEREG: 2,3" HIL_CSQ="99,99" npm run test:hil-cellular')
	line()
	line("SKIPPING — board present, no modem answers to judge yet.")
	return 0
}

process.exit(main())
