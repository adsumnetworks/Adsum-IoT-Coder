/**
 * U12 — the ESP chip table exists twice, and the two copies must agree.
 *
 * `adsum/esp/knowledge/chip-identity` is the home of record: target → name, CPU architecture, and
 * therefore which `addr2line` decodes a backtrace. It is a bit so that a part Espressif ships after our
 * release can be named by a registry update rather than a reinstall.
 *
 * `decode-fault` carries the same mapping inline, and has to: it runs zero-dependency, with no k-bit
 * cache and no host, so it cannot read the bit. That is a deliberate second copy — and a deliberate
 * second copy still needs something holding it to the first. The commit that introduced the pair said a
 * test failed if they ever disagreed; there was no such test. Every drift this week has been one fact
 * with two homes and nothing between them (the device registry, `knowledgeRoot()`, the webview's PCA
 * table), so this closes the one that was asserted but not written.
 *
 * Both directions: a target in the bit and not the tool means a chip whose backtrace cannot be decoded;
 * a target in the tool and not the bit means a chip the agent will never hear about.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"

const ROOT = join(__dirname, "..", "..", "..")
const BIT = join(ROOT, "iot-knowledge", "platforms", "esp", "knowledge", "chip-identity.md")
const TOOL = join(ROOT, "iot-knowledge", "tools", "decode-fault", "decode_fault.mjs")

/** target → addr2line prefix, from the bit's fenced YAML table. */
function fromBit(): Map<string, string> {
	const yaml = /```ya?ml\r?\n([\s\S]*?)```/.exec(readFileSync(BIT, "utf8"))?.[1] ?? ""
	const out = new Map<string, string>()
	for (const m of yaml.matchAll(/- target:\s*(\S+)[\s\S]*?addr2line:\s*(\S+)/g)) {
		out.set(m[1], m[2].replace(/-addr2line$/, ""))
	}
	return out
}

/** target → toolchain prefix, from the tool's inline object. */
function fromTool(): Map<string, string> {
	const js = readFileSync(TOOL, "utf8")
	const out = new Map<string, string>()
	for (const m of js.matchAll(/^\s+(esp32[a-z0-9]*):\s*"([^"]+)",/gm)) {
		out.set(m[1], m[2])
	}
	return out
}

describe("U12 — chip-identity and decode-fault name the same silicon", () => {
	test("both tables parse, and neither is empty", () => {
		assert.ok(fromBit().size >= 10, `the bit lists ${fromBit().size} targets — the parse or the table is wrong`)
		assert.ok(fromTool().size >= 10, `the tool lists ${fromTool().size} targets — the parse or the table is wrong`)
	})

	test("every target in the bit is decodable by the tool, with the same toolchain", () => {
		const [bit, tool] = [fromBit(), fromTool()]
		const wrong: string[] = []
		for (const [target, prefix] of bit) {
			const got = tool.get(target)
			if (got !== prefix) {
				wrong.push(`${target}: bit says ${prefix}, tool says ${got ?? "(absent — its backtraces cannot be decoded)"}`)
			}
		}
		assert.deepEqual(wrong, [], `chip tables disagree:\n  ${wrong.join("\n  ")}`)
	})

	test("every target the tool knows is one the agent has been told about", () => {
		const [bit, tool] = [fromBit(), fromTool()]
		const missing = [...tool.keys()].filter((t) => !bit.has(t))
		assert.deepEqual(missing, [], `decode-fault handles ${missing.join(", ")}, which chip-identity never mentions`)
	})

	test("the architecture the bit states matches the toolchain it names", () => {
		// xtensa parts get an xtensa- prefix, RISC-V parts get riscv32-. A row that says one and names the
		// other would send a backtrace through the wrong disassembler and produce confident nonsense.
		const yaml = /```ya?ml\r?\n([\s\S]*?)```/.exec(readFileSync(BIT, "utf8"))?.[1] ?? ""
		const bad: string[] = []
		for (const m of yaml.matchAll(/- target:\s*(\S+)\s*\n\s*name:[^\n]*\n\s*arch:\s*(\S+)\s*\n\s*addr2line:\s*(\S+)/g)) {
			const [, target, arch, a2l] = m
			const expected = arch === "xtensa" ? "xtensa-" : "riscv32-"
			if (!a2l.startsWith(expected)) {
				bad.push(`${target}: arch ${arch} but addr2line ${a2l}`)
			}
		}
		assert.deepEqual(bad, [], `arch and toolchain disagree:\n  ${bad.join("\n  ")}`)
	})
})
