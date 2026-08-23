/*! @license MIT — the btmon decoder is adapted from LogScope, https://github.com/novelbits/logscope */
/**
 * CLI entry for the `hci-decode` Tool bit.
 *
 * This file is never imported by the extension. `scripts/build-tool-bundles.mjs` bundles it, with
 * `hciParser.ts` and `format.ts`, into `iot-knowledge/platforms/nrf/tools/hci-decode/hci_decode.mjs`
 * — one source, two consumers, so the decoder cannot drift between the copy the tests exercise and
 * the copy that ships.
 *
 * Contract (the handler depends on every field):
 *   node hci_decode.mjs --in <capture.btmon> [--json]
 *   stdout, --json:  { status: "ok", text, entries, totalFrames, parseErrors }
 *   stdout, plain:   the formatted decode
 *   exit 0  a decode exists, even if it found zero entries — that is a result, not a failure
 *   exit 2  bad input: no --in, unreadable file, empty file
 *   exit 3  the decoder threw
 *
 * `text` rather than the entry array is what the handler writes to disk, so it must arrive whole:
 * the handler spawns this with a large maxBuffer for exactly that reason.
 */

import { readFileSync, writeSync } from "node:fs"
import { formatHci } from "./format"
import { parseHci } from "./hciParser"

function main(argv: string[]): void {
	const flag = (n: string) => argv.includes(`--${n}`)
	const opt = (n: string) => {
		const i = argv.indexOf(`--${n}`)
		return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null
	}

	if (flag("help") || flag("h")) {
		console.log("hci-decode --in <capture.btmon> [--json]\n\nDecode a btmon capture into a readable HCI trace.")
		return
	}

	/**
	 * Write and set an exit code — never `console.log` then `process.exit()`.
	 *
	 * On a pipe, stdout is asynchronous: `process.exit()` tears the process down before the buffer
	 * drains, and a decode larger than the pipe buffer arrives TRUNCATED with a zero exit status. The
	 * caller then sees well-formed-looking JSON that stops mid-string. `writeSync` to fd 1 is the fix,
	 * and letting the process end on its own is what guarantees the flush.
	 */
	const emit = (payload: Record<string, unknown>, code: number) => {
		const body = flag("json") ? `${JSON.stringify(payload, null, 2)}\n` : `${String(payload.text ?? "")}\n`
		if (flag("json") || code === 0) {
			writeSync(1, body)
		} else {
			writeSync(2, `hci-decode: ${payload.reason ?? "failed"}\n`)
		}
		process.exitCode = code
	}

	const input = opt("in")
	if (!input) {
		emit({ status: "bad-input", reason: "--in <capture.btmon> is required" }, 2)
		return
	}

	let buf: Buffer
	try {
		buf = readFileSync(input)
	} catch (e) {
		emit({ status: "bad-input", reason: `could not read ${input}: ${(e as Error).message}` }, 2)
		return
	}
	// An empty capture is a capture failure, not a decode of nothing. Saying "0 packets" here would
	// let the agent report a clean trace for a file the device never wrote to.
	if (buf.length === 0) {
		emit({ status: "bad-input", reason: `${input} is empty — nothing was captured` }, 2)
		return
	}

	try {
		const result = parseHci(buf)
		emit(
			{
				status: "ok",
				text: formatHci(result),
				entries: result.entries.length,
				totalFrames: result.totalFrames,
				parseErrors: result.parseErrors,
			},
			0,
		)
	} catch (e) {
		emit({ status: "decode-failed", reason: (e as Error).message }, 3)
	}
}

main(process.argv.slice(2))
