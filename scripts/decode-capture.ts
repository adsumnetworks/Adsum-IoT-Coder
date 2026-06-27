// Dev-only HIL helper: decodes a real `.pcap` (sniffer) or `.btmon` (HCI) capture through the exact same
// rail TriggerNordicActionHandler uses in production — decodeSnifferPcap() / formatHci(parseHci()) — so
// iterating the parser/format/mermaid footer against real bytes needs no F5 / extension reload.
// Dev-only: excluded from the packaged VSIX. See Adsum-Planning/operations/hardware-in-the-loop-testing.md.
//
// Usage: npm run dev:decode -- <path/to/capture.pcap|.btmon>

import * as fs from "node:fs"
import * as path from "node:path"
import { formatHci } from "../src/services/nrf/hci/format"
import { parseHci } from "../src/services/nrf/hci/hciParser"
import { decodeSnifferPcap } from "../src/services/nrf/sniffer/format"

function main() {
	const input = process.argv[2]
	if (!input) {
		console.error("Usage: npm run dev:decode -- <path/to/capture.pcap|.btmon>")
		process.exit(1)
	}
	const resolved = path.resolve(input)
	if (!fs.existsSync(resolved)) {
		console.error(`File not found: ${resolved}`)
		process.exit(1)
	}

	const buf = fs.readFileSync(resolved)
	const ext = path.extname(resolved).toLowerCase()

	let text: string
	let outPath: string
	if (ext === ".btmon") {
		text = formatHci(parseHci(buf))
		outPath = resolved.replace(/\.btmon$/i, ".hci.log")
	} else if (ext === ".pcap") {
		text = decodeSnifferPcap(buf).text
		outPath = resolved.replace(/\.pcap$/i, ".sniffer.log")
	} else {
		console.error(`Unrecognized extension "${ext}" — expected .pcap (sniffer) or .btmon (HCI).`)
		process.exit(1)
	}

	fs.writeFileSync(outPath, text, "utf8")
	console.log(`Decoded ${resolved} -> ${outPath}`)
	console.log(`(${text.split("\n").length} lines written)`)
}

main()
