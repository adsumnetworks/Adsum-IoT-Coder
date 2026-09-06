/**
 * The tab strip says one product.
 *
 * Two places create a terminal and they had drifted: the hostbridge path opened a tab labelled
 * "Cline" with Cline's robot, beside tabs from the registry labelled "Adsum IoT Coder". A developer
 * sees one product; the tab strip should not argue with them.
 *
 * A source scan, because the failure is a literal in a file rather than anything a running test
 * would reach — and it asserts the GUARANTEE (both read one helper) rather than the shape of it.
 *
 * Run: npm run test:terminal-identity
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

const ROOT = path.resolve(__dirname, "..", "..", "..", "..")
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8")

const CREATORS = [
	"src/hosts/vscode/terminal/VscodeTerminalRegistry.ts",
	"src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts",
]

describe("the terminal tab's identity", () => {
	test("every place that creates a terminal takes its name and icon from one helper", () => {
		for (const f of CREATORS) {
			const src = read(f)
			assert.ok(/createTerminal|TerminalOptions/.test(src), `${f} is listed as a terminal creator but does not create one`)
			assert.match(src, /terminalIdentity\(\)/, `${f} spells the terminal's name or icon itself`)
		}
	})

	test("no terminal is named for another product, and none carries another product's icon", () => {
		for (const f of CREATORS) {
			const src = read(f)
			assert.ok(!/name:\s*"Cline"/.test(src), `${f} names the terminal "Cline"`)
			assert.ok(!/cline-icon/.test(src), `${f} uses Cline's icon`)
		}
	})

	test("the helper names Adsum and reaches for the mark, not a wordmark", () => {
		const src = read(CREATORS[0])
		const helper = src.slice(src.indexOf("static terminalIdentity"))
		assert.match(helper, /name: "Adsum IoT Coder"/)
		// icon.svg is the starburst mark. A tab renders it at 16 px, where lettering is a smudge.
		assert.match(helper, /"icons", "icon\.svg"/)
		assert.match(helper, /adsum-iot-coder-icon/, "and a theme-icon fallback before the uri is set")
	})
})
