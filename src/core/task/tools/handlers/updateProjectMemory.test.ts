import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { readDevices, readStatus } from "../../../memory/workspace/store"
import { applyMemoryWrite } from "../../../memory/workspace/writeApply"
import {
	applyDefect,
	extractEvidence,
	lintJunk,
	parseDefectFields,
	validateMemoryWrite,
	type WriteAccepted,
} from "../../../memory/workspace/writeRules"

/**
 * `update_project_memory` — the write rules.
 *
 * These are the assertions that stop the model corrupting its own memory: it may not overwrite what
 * the host detected, it may not quietly replace the project's goal with the bug it happens to be
 * staring at, it may not file a defect it cannot back up, it may not declare its own fix verified,
 * and it may not turn memory into a log sink.
 *
 * Everything here is pure logic or a temp directory. No workspace, no TaskConfig, no hardware.
 * Run: npm run test:memory-write
 */

const NOW = "2026-08-07T10:00:00Z"

function tmpWorkspace(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-write-"))
	// Memory is only ever written inside a real project — a bare temp dir is refused by design, the
	// same guard that stops a prototype scaffolding .adsum onto someone's Desktop.
	fs.writeFileSync(path.join(root, "prj.conf"), "")
	return root
}

/** Validate + apply in one step, asserting the validation passed. */
function write(root: string, req: { target: string; op: string; id?: string; content?: string }) {
	const decision = validateMemoryWrite(req)
	assert.equal(decision.ok, true, `expected accept, got: ${decision.ok ? "" : decision.reason}`)
	return applyMemoryWrite(root, decision as WriteAccepted, NOW)
}

/** The rejection text, or a failure if the write was (wrongly) accepted. */
function rejection(req: { target: string; op: string; id?: string; content?: string }): string {
	const decision = validateMemoryWrite(req)
	assert.equal(decision.ok, false, "expected this write to be rejected")
	return (decision as { ok: false; reason: string }).reason
}

// ── (a) host-owned sections ──────────────────────────────────────────────────────

describe("host-owned sections are unreachable from the tool", () => {
	test("apps / hw-detected / toolchain / map are all refused, with a re-probe instruction", () => {
		for (const target of ["apps", "hw-detected", "toolchain", "map", "devices"]) {
			const reason = rejection({ target, op: "set", content: "gateway — nrf52840dk" })
			assert.match(reason, /host-owned/i, `'${target}' should be refused as host-owned`)
			assert.match(reason, /live detection/i, "the message must say where the value really comes from")
			assert.match(reason, /re-probed/i, "the message must tell the model what to do instead")
		}
	})

	test("a host-owned name smuggled in via 'id' is refused too", () => {
		assert.match(rejection({ target: "note", op: "set", id: "toolchain", content: "NCS 3.2.1" }), /host-owned/i)
	})

	test("the four model-owned targets are NOT caught by the ownership check", () => {
		assert.equal(validateMemoryWrite({ target: "goal", op: "set", content: "Ship the gateway." }).ok, true)
		assert.equal(validateMemoryWrite({ target: "hw-asserted", op: "append", content: "SW6 -> nRF only" }).ok, true)
		assert.equal(
			validateMemoryWrite({ target: "note", op: "set", id: "uart", content: "The bridge is 115200 8N1." }).ok,
			true,
		)
	})
})

// ── (b) goal is append-only history ──────────────────────────────────────────────

describe("goal — append-only, the previous goal is never silently replaced", () => {
	test("setting a new goal moves the old one into priorGoals", () => {
		const root = tmpWorkspace()
		try {
			write(root, { target: "goal", op: "set", content: "Ship the BWG840 gateway with the BLE-to-UART bridge." })
			// This is the failure mode being prevented: hours inside one bug, the "goal" becomes the bug.
			const res = write(root, { target: "goal", op: "set", content: "Stop the UART ring buffer dropping frames." })
			assert.equal(res.ok, true)

			const status = readStatus(root)
			assert.match(status.goal?.text ?? "", /ring buffer/, "the newest goal is on top")
			assert.equal(status.priorGoals?.length, 1, "exactly one prior goal kept")
			assert.match(status.priorGoals?.[0].text ?? "", /BWG840/, "the original objective survives")
			assert.match(res.message, /prior-goal history/i, "the model is told the old goal was kept")
			assert.match(res.message, /status\.json/, "the absolute path is reported back")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("re-setting the identical goal does not pile up duplicate history", () => {
		const root = tmpWorkspace()
		try {
			write(root, { target: "goal", op: "set", content: "Ship the gateway." })
			write(root, { target: "goal", op: "set", content: "Ship the gateway." })
			assert.equal(readStatus(root).priorGoals?.length ?? 0, 0)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("op=append on a goal is refused and points at target=defect", () => {
		const reason = rejection({ target: "goal", op: "append", content: "also fix the UART" })
		assert.match(reason, /append-only/i)
		assert.match(reason, /op=set/)
		assert.match(reason, /target=defect/, "the message must name the right home for bug-shaped text")
	})
})

// ── (c) defects require evidence; verified is host-only ──────────────────────────

describe("defect — evidence required, verification is not the model's to claim", () => {
	test("a defect with no path:line citation is rejected, and the message shows the shape", () => {
		const reason = rejection({
			target: "defect",
			op: "set",
			id: "ble-drop",
			content: "title: BLE disconnects randomly\nstate: open\nnext: look at the connection interval",
		})
		assert.match(reason, /at least one piece of evidence/i)
		assert.match(reason, /path:line/)
		assert.match(reason, /cap_1012\.log:2211-2247/, "the message must show a concrete example")
	})

	test("a defect WITH evidence is accepted and lands in status.json", () => {
		const root = tmpWorkspace()
		try {
			const res = write(root, {
				target: "defect",
				op: "set",
				id: "uart-drop",
				content: [
					"title: UART frames dropped after Wi-Fi reconnect",
					"state: open",
					"evidence: src/gw_uart.c:214",
					"evidence: logs/rtt/cap_1012.log:2211-2247",
					"next: log the ring-buffer high-water mark",
				].join("\n"),
			})
			assert.equal(res.ok, true, res.message)
			assert.match(res.message, /status\.json/, "absolute path returned so the model can read it back")

			const d = readStatus(root).defects.find((x) => x.id === "uart-drop")
			assert.ok(d, "the defect is in the ledger")
			assert.equal(d?.state, "open")
			assert.deepEqual(d?.evidence, ["src/gw_uart.c:214", "logs/rtt/cap_1012.log:2211-2247"])
			assert.equal(d?.nextStep, "log the ring-buffer high-water mark")
			assert.equal(d?.verified, undefined, "the model's write must not set verified")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("evidence cited mid-sentence counts — a small model writing prose is not blocked", () => {
		assert.deepEqual(extractEvidence("the overflow is in src/gw_uart.c:214, see logs/rtt/cap.log:2211-2247."), [
			"src/gw_uart.c:214",
			"logs/rtt/cap.log:2211-2247",
		])
		assert.equal(validateMemoryWrite({ target: "defect", op: "set", id: "x", content: "drops at src/gw.c:9" }).ok, true)
	})

	test("clock times and ESP-IDF tags are NOT mistaken for evidence", () => {
		assert.deepEqual(extractEvidence("at 12:34:56 the tag E (12345) printed"), [])
		assert.deepEqual(extractEvidence("see https://example.com:8080/docs"), [])
	})

	test("a model attempt to set verified is rejected and redirected to under-test", () => {
		const reason = rejection({
			target: "defect",
			op: "set",
			id: "uart-drop",
			content: "title: fixed it\nverified: true\nevidence: src/gw_uart.c:214",
		})
		assert.match(reason, /may not mark a defect verified/i)
		assert.match(reason, /host-stamped/i)
		assert.match(reason, /under-test/, "the message must name the state the model IS allowed to set")
	})

	test("'state: closed' in content is refused — closing is an op, not a field", () => {
		const reason = rejection({
			target: "defect",
			op: "set",
			id: "uart-drop",
			content: "state: closed\nevidence: src/gw_uart.c:214",
		})
		assert.match(reason, /op=close/)
	})

	test("a host-stamped verified flag survives a later model write", () => {
		const status = {
			schema: 1 as const,
			defects: [
				{
					id: "uart-drop",
					title: "UART drops",
					state: "under-test" as const,
					evidence: ["src/gw_uart.c:214"],
					verified: true,
					verifiedBy: "host",
					updatedAt: "2026-08-06T00:00:00Z",
				},
			],
		}
		const res = applyDefect(status, "set", "uart-drop", parseDefectFields("state: open\nevidence: src/gw_uart.c:300"), NOW)
		assert.equal(res.ok, true)
		const d = (res as { ok: true; status: typeof status }).status.defects[0]
		assert.equal(d.verified, true, "host stamp carried through untouched")
		assert.equal(d.verifiedBy, "host")
		assert.deepEqual(d.evidence, ["src/gw_uart.c:214", "src/gw_uart.c:300"], "evidence accumulates, never replaced")
	})
})

// ── (d) junk lint ────────────────────────────────────────────────────────────────

describe("junk lint — memory stores conclusions, logs stay in log files", () => {
	const PASTED_LOG = [
		"The capture shows the drop:",
		"[00:00:12.001] <inf> gw_uart: rx 128 bytes",
		"[00:00:12.004] <inf> gw_uart: rx 128 bytes",
		"[00:00:12.007] <wrn> gw_uart: ring buffer 92% full",
		"[00:00:12.010] <err> gw_uart: dropped 42 bytes",
		"[00:00:12.013] <err> gw_uart: dropped 61 bytes",
		"so the ring buffer overflows. src/gw_uart.c:214",
	].join("\n")

	const ORDINARY_PROSE = [
		"The ring buffer is sized by CONFIG_GW_UART_RX_BUF, which prj.conf pins at 256 bytes.",
		"Raising it to 1024 stops the overflow under a Wi-Fi reconnect burst.",
		"",
		"```",
		"CONFIG_GW_UART_RX_BUF=1024",
		"```",
		"",
		"Confirmed against prj.conf:31 and logs/rtt/cap_1012.log:2211-2247.",
	].join("\n")

	test("fires on a pasted capture and says to cite the path and range instead", () => {
		assert.ok(lintJunk(PASTED_LOG), "5 consecutive Zephyr log lines must trip the lint")
		const reason = rejection({ target: "defect", op: "set", id: "uart-drop", content: PASTED_LOG })
		assert.match(reason, /pasted output/i)
		assert.match(reason, /path and line range/i)
	})

	test("fires on an ESP-IDF paste and on a PowerShell transcript", () => {
		const esp = Array.from({ length: 5 }, (_, i) => `E (${1000 + i}) wifi: connect failed, reason 201`).join("\n")
		assert.ok(lintJunk(esp), "ESP-IDF log lines")
		const ps = [
			"PS C:\\work\\gw> west build -b nrf52840dk",
			"PS C:\\work\\gw> west flash",
			"PS C:\\work\\gw> west build -t menuconfig",
			"PS C:\\work\\gw> west build -p",
			"PS C:\\work\\gw> west flash",
		].join("\n")
		assert.ok(lintJunk(ps), "a terminal transcript")
	})

	test("does NOT fire on ordinary prose containing one short code snippet", () => {
		assert.equal(lintJunk(ORDINARY_PROSE), null)
		assert.equal(
			validateMemoryWrite({ target: "defect", op: "set", id: "uart-drop", content: ORDINARY_PROSE }).ok,
			true,
			"a normal write-up with one snippet and two citations must be accepted",
		)
	})

	test("a fenced block over 400 chars is refused and target=note is offered", () => {
		const big = "```c\n" + "static uint8_t rx_buf[256]; /* padding */\n".repeat(20) + "```"
		const reason = rejection({ target: "note", op: "set", id: "ringbuffer", content: big })
		assert.match(reason, /fenced code block/i)
		assert.match(reason, /400/)
	})
})

// ── (e) size caps ────────────────────────────────────────────────────────────────

describe("size caps come from memoryLimits.ts, and the rejection says how to shrink", () => {
	test("an oversize goal is rejected, naming both sizes", () => {
		const reason = rejection({ target: "goal", op: "set", content: "Ship the gateway and also ".repeat(25) })
		assert.match(reason, /over the 400-char limit/)
		assert.match(reason, /one sentence naming the outcome/i, "the advice must be goal-specific")
	})

	test("an oversize defect is rejected with defect-specific advice", () => {
		const reason = rejection({
			target: "defect",
			op: "set",
			id: "big",
			content: "The UART bridge drops frames when Wi-Fi reconnects; see src/gw_uart.c:214. ".repeat(30),
		})
		assert.match(reason, /over the 1,500-char limit/)
		assert.match(reason, /Never paste log bodies/i)
	})
})

// ── notes ────────────────────────────────────────────────────────────────────────

describe("note — a file on disk plus an index entry in PROJECT.md", () => {
	test("creates .adsum/notes/<slug>.md and indexes it with the ABSOLUTE path", () => {
		const root = tmpWorkspace()
		try {
			const res = write(root, {
				target: "note",
				op: "set",
				id: "uart-ringbuffer",
				content:
					"# UART ring buffer\n\nThe bridge copies into a 256-byte ring buffer sized by CONFIG_GW_UART_RX_BUF (prj.conf:31).",
			})
			assert.equal(res.ok, true, res.message)

			const file = path.join(root, ".adsum", "notes", "uart-ringbuffer.md")
			assert.ok(fs.existsSync(file), "the note file exists")
			assert.match(fs.readFileSync(file, "utf8"), /256-byte ring buffer/)
			assert.match(res.message, /uart-ringbuffer\.md/, "absolute path returned")

			const projectMd = fs.readFileSync(path.join(root, ".adsum", "PROJECT.md"), "utf8")
			assert.match(projectMd, /## Notes/, "the notes index section was created")
			assert.match(projectMd, /UART ring buffer/, "the heading became the index title")
			assert.ok(projectMd.includes(file), "the index entry carries the absolute path")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("append extends the file and does not duplicate the index entry", () => {
		const root = tmpWorkspace()
		try {
			write(root, { target: "note", op: "set", id: "uart-ringbuffer", content: "# UART ring buffer\n\nFirst finding." })
			write(root, { target: "note", op: "append", id: "uart-ringbuffer", content: "Second finding, see prj.conf:31." })

			const file = path.join(root, ".adsum", "notes", "uart-ringbuffer.md")
			const body = fs.readFileSync(file, "utf8")
			assert.match(body, /First finding/)
			assert.match(body, /Second finding/)

			const projectMd = fs.readFileSync(path.join(root, ".adsum", "PROJECT.md"), "utf8")
			const entries = projectMd.split("\n").filter((l) => l.includes("uart-ringbuffer.md"))
			assert.equal(entries.length, 1, "exactly one index entry")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("a note without an id is refused, because the id is the file name", () => {
		assert.match(rejection({ target: "note", op: "set", content: "something" }), /requires 'id'/)
	})
})

// ── hw-asserted routing ──────────────────────────────────────────────────────────

describe("hw-asserted — PROJECT.md is the primary, devices.json.mode is the mirror", () => {
	test("writes the PROJECT.md section and mirrors onto a known device", () => {
		const root = tmpWorkspace()
		try {
			fs.mkdirSync(path.join(root, ".adsum", "local"), { recursive: true })
			fs.writeFileSync(
				path.join(root, ".adsum", "local", "devices.json"),
				JSON.stringify({ schema: 1, devices: [{ id: "683335182", kind: "jlink", port: "COM9" }] }),
			)

			const res = write(root, {
				target: "hw-asserted",
				op: "set",
				id: "683335182",
				content: "DK in standalone mode, SW6 -> nRF only",
			})
			assert.equal(res.ok, true, res.message)

			const projectMd = fs.readFileSync(path.join(root, ".adsum", "PROJECT.md"), "utf8")
			assert.match(projectMd, /Hardware — asserted by developer/)
			assert.match(projectMd, /683335182 — DK in standalone mode, SW6 -> nRF only/)

			assert.equal(readDevices(root).devices[0].mode, "DK in standalone mode, SW6 -> nRF only", "mirrored onto the device")
			assert.match(res.message, /mirrored onto known device/i)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("append keeps facts about other boards; set replaces only this board's fact", () => {
		const root = tmpWorkspace()
		try {
			write(root, { target: "hw-asserted", op: "append", id: "683335182", content: "SW6 -> nRF only" })
			write(root, { target: "hw-asserted", op: "append", id: "COM10", content: "ESP32 RX jumpered to P0.13" })
			write(root, { target: "hw-asserted", op: "set", id: "683335182", content: "SW6 -> nRF+external" })

			const projectMd = fs.readFileSync(path.join(root, ".adsum", "PROJECT.md"), "utf8")
			assert.match(projectMd, /COM10 — ESP32 RX jumpered to P0\.13/, "the other board's fact survives")
			assert.match(projectMd, /683335182 — SW6 -> nRF\+external/)
			assert.doesNotMatch(projectMd, /683335182 — SW6 -> nRF only/, "the superseded fact for THIS board is gone")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

// ── shape errors ─────────────────────────────────────────────────────────────────

describe("shape errors teach the contract", () => {
	test("missing target, unknown target, missing op, missing content", () => {
		assert.match(rejection({ target: "", op: "set", content: "x" }), /Missing 'target'/)
		assert.match(rejection({ target: "hardware-notes", op: "set", content: "x" }), /Unknown target/)
		assert.match(rejection({ target: "goal", op: "", content: "x" }), /Missing 'op'/)
		assert.match(rejection({ target: "goal", op: "set", content: "   " }), /requires 'content'/)
	})

	test("close and delete may omit content", () => {
		assert.equal(validateMemoryWrite({ target: "defect", op: "close", id: "uart-drop" }).ok, true)
		assert.equal(validateMemoryWrite({ target: "note", op: "delete", id: "uart" }).ok, true)
	})

	test("closing a defect that was never recorded is refused with a way forward", () => {
		const root = tmpWorkspace()
		try {
			const decision = validateMemoryWrite({ target: "defect", op: "close", id: "ghost" })
			const res = applyMemoryWrite(root, decision as WriteAccepted, NOW)
			assert.equal(res.ok, false)
			assert.match(res.message, /nothing to close/i)
			assert.match(res.message, /op=set/)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})
