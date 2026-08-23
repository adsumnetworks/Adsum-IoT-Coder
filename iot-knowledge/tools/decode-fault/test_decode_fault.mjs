/**
 * U6 — decode-fault.
 *
 * NOT declared in artifacts[]: tests are not shipped. Every declared member is fetched and hashed on
 * every developer's machine, so a test file there is a download nobody runs.
 *
 * The assertions that matter are the refusals. A decoder that guesses is worse than no decoder, so
 * each "we will not answer that" path is pinned: no toolchain, no .elf, a stack overflow, a log with
 * no fault in it.
 */

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"
import { chipFromLog, detectPlatform, extractAddresses, refusalFor, resolveAddr2line } from "./decode_fault.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(HERE, "decode_fault.mjs")

/** Run the CLI and return { code, stdout, stderr } without throwing on a non-zero exit. */
function run(args, input = "") {
	try {
		const stdout = execFileSync(process.execPath, [CLI, ...args], { input, encoding: "utf8", timeout: 30000 })
		return { code: 0, stdout, stderr: "" }
	} catch (e) {
		return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
	}
}

// ── fixtures: real dump shapes, verbatim ─────────────────────────────────────

const ZEPHYR_USAGE_FAULT = `
[00:00:03.412,000] <err> os: ***** USAGE FAULT *****
[00:00:03.412,000] <err> os:   Attempt to execute undefined instruction
[00:00:03.412,000] <err> os: r0/a1:  0x00000000  r1/a2:  0x2000a1c8  r2/a3:  0x00000001
[00:00:03.412,000] <err> os: r12/ip:  0x00000000 r14/lr:  0x000117a5
[00:00:03.412,000] <err> os:  xpsr:  0x61000000
[00:00:03.412,000] <err> os: Faulting instruction address (r15/pc): 0x0001180c
[00:00:03.412,000] <err> os: >>> ZEPHYR FATAL ERROR 0: CPU exception on CPU 0
`

const ZEPHYR_STACK_OVERFLOW = `
[00:00:01.002,000] <err> os: ***** MPU FAULT *****
[00:00:01.002,000] <err> os:   Stack overflow (context area not valid)
[00:00:01.002,000] <err> os: Faulting instruction address (r15/pc): 0x0002a13c
`

const ESP_XTENSA = `
Guru Meditation Error: Core  0 panic'ed (LoadProhibited). Exception was unhandled.
Core  0 register dump:
PC      : 0x42016d2c  PS      : 0x00060730  A0      : 0x820088ac
Backtrace: 0x42016d29:0x3fc98d00 0x420088a9:0x3fc98d20 0x4200a1b5:0x3fc98d40
ESP-ROM:esp32s3-20210327
`

const ESP_RISCV = `
Guru Meditation Error: Core  0 panic'ed (Load access fault). Exception was unhandled.
MEPC    : 0x42007988  RA      : 0x42007a4e  SP      : 0x3fc98d00
I (31) boot: ESP-IDF v6.0.1 2nd stage bootloader
I (31) boot: chip revision: v0.1
ESP32-C6 chip
`

const HEALTHY = "I (245) wifi:mode : softAP\nI (250) app: ready\n"

// ── platform + refusal detection ─────────────────────────────────────────────

describe("U6 — what is, and is not, an address fault", () => {
	test("a Zephyr usage fault is an nRF fault", () => {
		assert.equal(detectPlatform(ZEPHYR_USAGE_FAULT), "nrf")
		assert.equal(refusalFor(ZEPHYR_USAGE_FAULT), null)
	})
	test("both ESP dump shapes are ESP faults", () => {
		assert.equal(detectPlatform(ESP_XTENSA), "esp")
		assert.equal(detectPlatform(ESP_RISCV), "esp")
	})
	test("a healthy log has no fault at all", () => {
		assert.equal(detectPlatform(HEALTHY), null)
	})
	test("a stack overflow is refused, not decoded — the frame is corrupt", () => {
		assert.match(refusalFor(ZEPHYR_STACK_OVERFLOW), /stack overflow/i)
	})
	test("a watchdog and a brownout are refused for the same reason", () => {
		assert.ok(refusalFor("Task watchdog got triggered. The following tasks did not reset:"))
		assert.ok(refusalFor("Brownout detector was triggered"))
	})
})

// ── address extraction: the two syntaxes ─────────────────────────────────────

describe("U6 — Xtensa pairs and bare addresses are different syntaxes", () => {
	test("Xtensa backtrace frames keep their PC:SP pairing", () => {
		const { frames, syntax } = extractAddresses(ESP_XTENSA, "esp")
		assert.equal(syntax, "xtensa-pairs")
		assert.deepEqual(
			frames.map((f) => f.arg),
			["0x42016d29:0x3fc98d00", "0x420088a9:0x3fc98d20", "0x4200a1b5:0x3fc98d40"],
		)
	})
	test("RISC-V decodes MEPC and RA, bare", () => {
		const { frames, syntax } = extractAddresses(ESP_RISCV, "esp")
		assert.equal(syntax, "riscv-bare")
		assert.deepEqual(
			frames.map((f) => f.arg),
			["0x42007988", "0x42007a4e"],
		)
	})
	test("Zephyr decodes PC and LR, bare", () => {
		const { frames } = extractAddresses(ZEPHYR_USAGE_FAULT, "nrf")
		assert.deepEqual(
			frames.map((f) => f.arg),
			["0x0001180c", "0x000117a5"],
		)
	})
	test("addresses are taken verbatim — never normalised, rounded or re-cased", () => {
		const { frames } = extractAddresses(ESP_XTENSA, "esp")
		assert.ok(ESP_XTENSA.includes(frames[0].arg), "the extracted string must appear in the log as-is")
	})
})

describe("U6 — the chip decides the Xtensa prefix", () => {
	test("the boot banner names it", () => {
		assert.equal(chipFromLog(ESP_XTENSA), "esp32s3")
		assert.equal(chipFromLog(ESP_RISCV), "esp32c6")
	})
	test("a RISC-V part resolves to the shared riscv32 toolchain", () => {
		const { searched } = resolveAddr2line("esp", "esp32c6", null)
		assert.ok(searched.some((s) => s.includes("riscv32-esp-elf")))
	})
	test("an Xtensa part resolves to its own per-chip toolchain", () => {
		const { searched } = resolveAddr2line("esp", "esp32s3", null)
		assert.ok(searched.some((s) => s.includes("xtensa-esp32s3-elf")))
	})
	test("nRF never looks for a chip-specific prefix", () => {
		const { searched } = resolveAddr2line("nrf", null, null)
		assert.ok(searched.every((s) => !s.includes("xtensa")))
		assert.ok(searched.some((s) => s.includes("arm-zephyr-eabi-addr2line")))
	})
})

// ── the refusals, end to end ─────────────────────────────────────────────────

describe("U6 — the CLI refuses clearly rather than guessing", () => {
	test("--elf is required, and says why", () => {
		const r = run(["--json"], ZEPHYR_USAGE_FAULT)
		assert.equal(r.code, 2)
		assert.match(r.stdout, /"status": "elf-required"/)
		assert.match(r.stdout, /sysbuild/)
	})

	test("a missing .elf is exit 2, not a decode against nothing", () => {
		const r = run(["--elf", "/nonexistent/app.elf", "--json"], ZEPHYR_USAGE_FAULT)
		assert.equal(r.code, 2)
		assert.match(r.stdout, /"status": "elf-not-found"/)
	})

	test("no toolchain is a STRUCTURED refusal — never empty output, never a guessed line", () => {
		// A real .elf (this file stands in — the toolchain check comes first) and an addr2line that
		// cannot exist, so the resolver exhausts every candidate.
		const r = run(["--elf", CLI, "--addr2line", "/nonexistent/arm-zephyr-eabi-addr2line", "--json"], ZEPHYR_USAGE_FAULT)
		assert.equal(r.code, 2)
		assert.match(r.stdout, /"status": "addr2line-failed"|"status": "toolchain-not-found"/)
		assert.doesNotMatch(r.stdout, /no fault/i, "a missing toolchain must never read as 'no fault found'")
	})

	test("a stack overflow exits 0 saying it will not decode — it is not an error", () => {
		const r = run(["--elf", CLI, "--json"], ZEPHYR_STACK_OVERFLOW)
		assert.equal(r.code, 0)
		assert.match(r.stdout, /"status": "not-an-address-fault"/)
		assert.match(r.stdout, /stack overflow/i)
	})

	test("a healthy log exits 0 saying there is nothing to decode", () => {
		const r = run(["--elf", CLI, "--json"], HEALTHY)
		assert.equal(r.code, 0)
		assert.match(r.stdout, /"status": "no-fault-found"/)
	})

	test("a fault banner with no readable address is exit 2, not a silent success", () => {
		const r = run(["--elf", CLI, "--json"], ">>> ZEPHYR FATAL ERROR 0: CPU exception on CPU 0\n")
		assert.equal(r.code, 2)
		assert.match(r.stdout, /"status": "no-addresses"/)
	})

	test("--help works without any of the above", () => {
		const r = run(["--help"])
		assert.equal(r.code, 0)
		assert.match(r.stdout, /decode-fault --elf/)
	})
})

// ── a real decode, using the host's own addr2line as a stand-in ──────────────

describe("U6 — a decode that actually runs", () => {
	const hostAddr2line = (() => {
		for (const c of ["/usr/bin/addr2line", "/opt/homebrew/opt/binutils/bin/addr2line"]) {
			try {
				execFileSync(c, ["--version"], { stdio: "ignore", timeout: 5000 })
				return c
			} catch {}
		}
		return null
	})()

	test(
		"frames come back in order, one resolved line each",
		{ skip: hostAddr2line ? false : "no host addr2line — cross-toolchain decode is covered by K4 on hardware" },
		() => {
			// Decoding this platform's own binary with this platform's addr2line: the addresses will not
			// resolve to anything meaningful, which is the point — what is asserted is the plumbing
			// (frame order, one line per frame, exit 0), not the symbol resolution.
			const r = run(["--elf", process.execPath, "--addr2line", hostAddr2line, "--platform", "nrf", "--json"], ZEPHYR_USAGE_FAULT)
			assert.equal(r.code, 0, r.stderr)
			const out = JSON.parse(r.stdout)
			assert.equal(out.status, "ok")
			assert.equal(out.frames.length, 2)
			assert.equal(out.frames[0].address, "0x0001180c")
			assert.equal(out.frames[1].address, "0x000117a5")
			assert.ok(out.frames.every((f) => typeof f.resolved === "string"))
		},
	)
})
