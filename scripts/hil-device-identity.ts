/**
 * Hardware-in-the-loop test for DEVICE IDENTITY — the rail that decides which board knowledge the
 * agent is given, driven against boards actually plugged into this machine.
 *
 * Why this exists (2026-08-14): a Seeed XIAO nRF54LM20A was on the bench and the agent spent a whole
 * session insisting the developer owned an nRF54L15 DK. Every unit test passed, because the failure
 * was in what real hardware reports: the XIAO carries an on-board CMSIS-DAP rather than a SEGGER
 * J-Link, so `nrfutil device list` returns no `devkit` and no `jlink` object and the board was dropped
 * as "not Nordic" before anything could route it. Only real hardware produces that shape.
 *
 * Hardware-gated, like scripts/hil-test.ts: it skips cleanly (exit 0) when nothing is attached, so it
 * can never fail a machine without boards.
 *
 *   npm run test:hil-identity
 *   HIL_ESP_PORT=COM4 npm run test:hil-identity     (also probe the ESP chip on that port)
 */

import { execFileSync } from "node:child_process"
import { getBoardKnowledgeFile, getEspBoardKnowledgeFile } from "../src/core/prompts/system-prompt/components/iot_context"
import { getIdfPython, parseEsptoolChip, probeChip, resolveIdfPython } from "../src/services/esp/espChipProbe"
import {
	isNordicBoard,
	nordicChipFromProduct,
	parseDeviceListFull,
	resolveNrfutilCommands,
} from "../src/services/nrf/EnvironmentDetector"

const failures: string[] = []
const notes: string[] = []

function check(ok: boolean, what: string): void {
	console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`)
	if (!ok) {
		failures.push(what)
	}
}

function nrfutilBin(): string | undefined {
	const { devicePrefix } = resolveNrfutilCommands({})
	const m = devicePrefix.match(/^"?(.+?)"?\s+device$/)
	const bin = m ? m[1] : devicePrefix.replace(/^"|"$/g, "")
	try {
		execFileSync(bin, ["--version"], { stdio: "ignore" })
		return bin
	} catch {
		return undefined
	}
}

async function nordicSection(): Promise<void> {
	const bin = nrfutilBin()
	if (!bin) {
		notes.push("nrfutil not found — skipped the Nordic half")
		return
	}
	console.log(`\n[nordic] using ${bin}`)

	let stdout: string
	try {
		stdout = execFileSync(bin, ["device", "list", "--json"], { encoding: "utf8", timeout: 20_000 })
	} catch (e) {
		notes.push(`nrfutil device list failed: ${e instanceof Error ? e.message : e}`)
		return
	}

	const entries = parseDeviceListFull(stdout)
	if (entries.length === 0) {
		notes.push("no devices enumerated — skipped the Nordic half")
		return
	}

	console.log(`[nordic] ${entries.length} device(s) enumerated`)
	let nordicKept = 0
	for (const e of entries) {
		const board = {
			serialNumber: e.serialNumber,
			deviceFamily: e.deviceFamily,
			boardVersion: e.boardVersion,
			productName: e.usbProduct,
			deviceName: e.deviceFamily ? undefined : nordicChipFromProduct(e.usbProduct),
		}
		const kept = isNordicBoard(board)
		const routed = kept ? getBoardKnowledgeFile(board.productName || board.deviceName || "") : undefined
		console.log(
			`  ${e.serialNumber}  product=${e.usbProduct ?? "(none)"}  jlink=${e.traits?.jlink ?? "?"}  ` +
				`→ ${kept ? "kept" : "dropped"}${routed ? `  → ${routed}` : ""}`,
		)
		if (kept) {
			nordicKept++
		}

		// The regression itself: a board whose product string names an nRF part MUST survive the filter,
		// however it debugs. Anything that names no Nordic part must still be dropped (an ESP32 on the
		// same bus enumerates here too, and must not leak into the nRF strip).
		const namesNordic = !!nordicChipFromProduct(e.usbProduct) || !!e.deviceFamily || !!e.boardVersion
		check(kept === namesNordic, `${e.serialNumber}: kept(${kept}) matches "names a Nordic part"(${namesNordic})`)

		// A XIAO must never route to the DK bit — same silicon, different board, different pins.
		if (/xiao/i.test(e.usbProduct ?? "")) {
			check(
				routed === "platforms/nrf/boards/xiao-nrf54lm20a.md",
				`XIAO routes to its own bit, not the DK's (got ${routed})`,
			)
		}
	}
	if (nordicKept === 0) {
		notes.push("no Nordic board among the enumerated devices")
	}
}

async function espSection(): Promise<void> {
	const port = process.env.HIL_ESP_PORT
	if (!port) {
		notes.push("HIL_ESP_PORT not set — skipped the ESP half")
		return
	}
	const python =
		getIdfPython() ?? resolveIdfPython({ platform: process.platform, env: process.env, home: require("node:os").homedir() })
	if (!python) {
		notes.push("no IDF python env found — skipped the ESP half")
		return
	}
	console.log(`\n[esp] probing ${port} with ${python}`)

	// A port held by another process is an ENVIRONMENT condition, not a product defect — most often a
	// leftover `idf.py monitor` from an earlier session still holding it. Treat it the same way as
	// "no hardware attached": report it and skip, rather than reporting a failure this code did not cause.
	try {
		const probe = execFileSync(python, ["-m", "esptool", "--port", port, "flash_id"], {
			encoding: "utf8",
			timeout: 30_000,
			stdio: ["ignore", "pipe", "pipe"],
		})
		void probe
	} catch (e) {
		const out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}${e instanceof Error ? e.message : ""}`
		if (/port is busy|Access is denied|PermissionError|could not open port/i.test(out)) {
			notes.push(
				`${port} is held by another process (a leftover serial monitor?) — skipped the ESP half. ` +
					`Close it and re-run to exercise this rail.`,
			)
			return
		}
	}

	let chip: string | undefined
	try {
		const res = await probeChip(python, port)
		chip = res.chip
		console.log(`  chip=${res.chip ?? "(unresolved)"} rev=${res.chipRevision ?? "-"} mac=${res.mac ?? "-"}`)
	} catch (e) {
		notes.push(`esptool probe failed on ${port}: ${e instanceof Error ? e.message : e}`)
		return
	}

	check(!!chip, `esptool resolved a chip on ${port} (this is the probe the agent must NOT repeat)`)
	if (chip) {
		const bit = getEspBoardKnowledgeFile(chip)
		console.log(`  ${chip} → ${bit ?? "(no board bit)"}`)
		check(!!bit, `the probed chip ${chip} routes to a board bit without any build existing`)
	}
}

async function main(): Promise<void> {
	console.log("[test:hil-identity] device identity against real hardware")
	await nordicSection()
	await espSection()

	if (notes.length > 0) {
		console.log(`\n[test:hil-identity] notes:\n  - ${notes.join("\n  - ")}`)
	}
	if (failures.length > 0) {
		console.error(`\n[test:hil-identity] FAIL — ${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`)
		process.exit(1)
	}
	console.log("\n[test:hil-identity] PASS")
}

main().catch((e) => {
	console.error(`[test:hil-identity] FAIL — ${e instanceof Error ? e.stack : e}`)
	process.exit(1)
})

// Keep the esptool parser referenced so a future refactor cannot silently drop it from this rail.
void parseEsptoolChip
