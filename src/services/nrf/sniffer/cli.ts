/**
 * CLI entry for the `sniffer-decode` Tool bit.
 *
 * Never imported by the extension. `scripts/build-tool-bundles.mjs` bundles it with the PCAP reader,
 * the Nordic BLE parser and the formatter into
 * `iot-knowledge/platforms/nrf/tools/sniffer-decode/sniffer_decode.mjs` — one source, two consumers.
 *
 * Contract (the handler branches on `totalFrames`, so it must always be present):
 *   node sniffer_decode.mjs --in <capture.pcap> [--json]
 *   stdout, --json:  { status: "ok", text, totalFrames }
 *   stdout, plain:   the formatted decode
 *   exit 0  a decode exists. `totalFrames: 0` is a legitimate result — a dongle that saw no traffic —
 *           and the handler has its own wording for it.
 *   exit 2  bad input: no --in, unreadable, or an EMPTY file. An empty capture is a capture failure;
 *           reporting it as "0 packets" would read as "the air was quiet", which is a different and
 *           much more expensive wrong answer.
 *   exit 3  the decoder threw
 */

import { readFileSync, writeSync } from "node:fs"
import { decodeSnifferPcap } from "./format"

function main(argv: string[]): void {
	const flag = (n: string) => argv.includes(`--${n}`)
	const opt = (n: string) => {
		const i = argv.indexOf(`--${n}`)
		return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null
	}

	if (flag("help") || flag("h")) {
		console.log("sniffer-decode --in <capture.pcap> [--json]\n\nDecode a Nordic BLE sniffer PCAP into a readable trace.")
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
			writeSync(2, `sniffer-decode: ${payload.reason ?? "failed"}\n`)
		}
		process.exitCode = code
	}

	const input = opt("in")
	if (!input) {
		emit({ status: "bad-input", reason: "--in <capture.pcap> is required" }, 2)
		return
	}

	let buf: Buffer
	try {
		buf = readFileSync(input)
	} catch (e) {
		emit({ status: "bad-input", reason: `could not read ${input}: ${(e as Error).message}` }, 2)
		return
	}
	if (buf.length === 0) {
		emit({ status: "bad-input", reason: `${input} is empty — no packets were captured` }, 2)
		return
	}

	try {
		const { text, result } = decodeSnifferPcap(buf)
		emit({ status: "ok", text, totalFrames: result.totalFrames }, 0)
	} catch (e) {
		emit({ status: "decode-failed", reason: (e as Error).message }, 3)
	}
}

main(process.argv.slice(2))
