import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"
import { ATTRIBUTION_FALLBACK, creditFieldsFromYaml, creditFromMeta, leadSentence } from "./credit"

const ROOT = join(__dirname, "..", "..", "..", "..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8")
/** Source with comments removed — the copy-law comments legitimately NAME the banned words. */
const code = (rel: string) =>
	read(rel)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*(\/\/|\*).*$/gm, "")

/** Every file that renders attribution copy to a user. New attribution UI must be added here. */
const ATTRIBUTION_UI = [
	"webview-ui/src/components/chat/KbitCredit.tsx",
	"webview-ui/src/components/chat/task-header/KbitPill.tsx",
	"src/services/knowledge/kbit/credit.ts",
]

describe("attribution — credit facts", () => {
	test("a real author is credited and marked attributed", () => {
		const c = creditFromMeta({ id: "adsum/nrf/actions/flash", title: "Flash", type: "action", author: "Omar Morceli" })
		assert.equal(c.author, "Omar Morceli")
		assert.equal(c.attributed, true)
		assert.equal(c.kind, "knowledge") // only `type: tool` is a Tool bit
	})

	test("the shipped `author: adsum` placeholder is NOT a person — degrade honestly", () => {
		// The corpus shipped with this placeholder on every bit. Rendering it as a credit would claim
		// attribution nobody gave, so it must fall back rather than print a handle as an author.
		for (const placeholder of ["adsum", "adsum-core", "", "  "]) {
			const c = creditFromMeta({ id: "adsum/rules/core", author: placeholder })
			assert.equal(c.attributed, false, `"${placeholder}" must not read as an author`)
			assert.equal(c.author, ATTRIBUTION_FALLBACK)
		}
	})

	test("a Tool bit is a Tool bit", () => {
		assert.equal(creditFromMeta({ id: "x", type: "tool" }).kind, "tool")
	})

	test("title falls back to a humanised id, never blank", () => {
		assert.equal(creditFromMeta({ id: "adsum/nrf/actions/capture-logs" }).title, "Capture Logs")
	})

	test("frontmatter scalars are read without a YAML dependency", () => {
		const meta = creditFieldsFromYaml(
			[
				"id: adsum/nrf/actions/flash",
				'title: "Flash the board"',
				"type: action",
				"author: Omar Morceli",
				"version: 1.2.0",
			].join("\n"),
		)
		assert.equal(meta.author, "Omar Morceli")
		assert.equal(meta.title, "Flash the board") // quotes stripped
		assert.equal(meta.version, "1.2.0")
	})
})

describe("attribution — derived lead sentence", () => {
	test("names the curator when there is one, and never invents one when there is not", () => {
		const withAuthor = leadSentence(creditFromMeta({ id: "a", author: "Omar Morceli", platform: "nrf" }))
		assert.match(withAuthor, /Omar Morceli/)
		const without = leadSentence(creditFromMeta({ id: "a", author: "adsum", platform: "nrf" }))
		assert.doesNotMatch(without, /adsum(?!\s+Networks)/i)
		assert.match(without, /Adsum Networks/) // steward is still stated
	})

	test("the hardware clause renders ONLY when a witness record exists", () => {
		const c = creditFromMeta({ id: "a", author: "Omar Morceli", platform: "nrf" })
		assert.doesNotMatch(leadSentence(c), /Run on/)
		const witnessed = { ...c, witness: { board: "nRF5340-DK", toolchain: "NCS 3.2.1", on: "2026-07-01" } }
		assert.match(leadSentence(witnessed), /Run on nRF5340-DK \(NCS 3\.2\.1 · 2026-07-01\)/)
	})

	test("lead sentences carry no verdict words", () => {
		const samples = [
			creditFromMeta({ id: "a", author: "Omar Morceli", platform: "nrf", type: "knowledge" }),
			creditFromMeta({ id: "b", author: "Ismail Hamdad", platform: "esp", type: "tool" }),
			creditFromMeta({ id: "c", platform: "universal" }),
		].map(leadSentence)
		for (const s of samples) {
			assert.doesNotMatch(s, /\b(certified|verified|approved|guaranteed|compliant|passes)\b/i, s)
		}
	})
})

describe("attribution — copy law (build-time lint)", () => {
	// design/01: attribution is credit, never a verdict. A regression here is a trust bug, not a typo.
	test("no verdict words in any attribution UI", () => {
		for (const rel of ATTRIBUTION_UI) {
			const src = code(rel)
			for (const term of ["certified", "verified", "approved", "guaranteed", "compliant"]) {
				assert.doesNotMatch(src, new RegExp(`\\b${term}\\b`, "i"), `${rel} must not render "${term}"`)
			}
		}
	})

	test("official terminology — Knowledge bit / Tool bit, never 'capability'", () => {
		for (const rel of ATTRIBUTION_UI) {
			const src = code(rel)
			assert.doesNotMatch(src, /\bcapability\b/i, `${rel}: "capability" was retired as a user-facing label`)
			// lowercase "kbit" collides with kilobit in UI copy; internal identifiers (KbitCredit, kbit_loaded)
			// are code, so only quoted display strings are checked.
			const displayStrings = [...src.matchAll(/["'`]([^"'`]{3,80})["'`]/g)].map((m) => m[1])
			for (const s of displayStrings) {
				assert.doesNotMatch(s, /\bkbits?\b/, `${rel}: display string "${s}" must say "K-bit", not "kbit"`)
			}
		}
	})

	test("the popover never links bit content or shows tree paths", () => {
		// The knowledge tree's layout is itself IP and proprietary bodies must not be one click away.
		const ui = read("webview-ui/src/components/chat/KbitCredit.tsx")
		assert.doesNotMatch(ui, /iot-knowledge/, "attribution UI must not reference the bundled tree path")
		assert.doesNotMatch(ui, /open bit file/i, "bit content must not be linked from the chat")
	})

	test("the provenance boundary is documented, and the popover links to it", () => {
		// The "attribution is not a verdict" boundary moved out of per-popover small print and into the docs.
		// That is only safe while BOTH hold: the popover points at the explanation, and the docs still carry it.
		const ui = read("webview-ui/src/components/chat/KbitCredit.tsx")
		assert.match(ui, /docs\.adsumnetworks\.com\/knowledge-bits/, "popover must link to the Knowledge bits docs")
		assert.match(ui, /Learn more about Knowledge bits/, "the link must be discoverable copy, not a bare URL")
	})

	test("no permanently-pending placeholder rows", () => {
		// A row that says "pending" on every bit forever reads as a defect, not a roadmap. Restore the signing
		// row when signatures are real — the copy law for it (two facts, never "Signed by <person>") stands.
		const ui = read("webview-ui/src/components/chat/KbitCredit.tsx")
		assert.doesNotMatch(ui, /signature pending/i, "hidden until signatures exist")
	})

	test("attribution UI uses the brand palette only — no off-palette hues", () => {
		// UI-GOLDEN-RULES: coral = identity, cyan = action. An earlier pass shipped violet (carried in from a
		// prototype mockup), which is in no palette at all. Colours must come from brandColors, and kind must
		// be carried by the mark's SHAPE rather than by hue.
		for (const rel of ["webview-ui/src/components/chat/KbitCredit.tsx", "webview-ui/src/components/chat/task-header/KbitPill.tsx"]) {
			const src = code(rel)
			for (const offPalette of ["charts-purple", "charts-orange", "violet", "purple"]) {
				assert.doesNotMatch(src, new RegExp(offPalette, "i"), `${rel}: "${offPalette}" is not in the Adsum palette`)
			}
		}
	})

	test("`tier` is never rendered", () => {
		for (const rel of ATTRIBUTION_UI) {
			assert.doesNotMatch(code(rel), /\btier\b/i, `${rel}: tier is a schema field, never user-facing copy`)
		}
	})
})

describe("attribution — the corpus is actually attributed", () => {
	test("bundled platform bits name a real curator (the allocation ruling is applied)", () => {
		const manifest = JSON.parse(read("iot-knowledge/manifest.json")) as {
			bits: Array<{ id: string; author?: string }>
		}
		const platformBits = manifest.bits.filter((b) => /\/(nrf|esp)\//.test(b.id))
		assert.ok(platformBits.length > 0, "expected platform bits in the manifest")
		for (const b of platformBits) {
			const c = creditFromMeta(b)
			assert.equal(c.attributed, true, `${b.id} is unattributed — the allocation ruling was not applied`)
		}
	})

	test("the BLE NUS reference is attributed to Ismail per the ruling", () => {
		const manifest = JSON.parse(read("iot-knowledge/manifest.json")) as {
			bits: Array<{ id: string; author?: string }>
		}
		for (const id of ["adsum/nrf/workflows/demo-debug", "adsum/nrf/sdks/ncs/protocols/ble"]) {
			const bit = manifest.bits.find((b) => b.id === id)
			assert.ok(bit, `${id} missing from the manifest`)
			assert.equal(bit.author, "Ismail Hamdad", `${id} must follow the allocation ruling`)
		}
	})
})
