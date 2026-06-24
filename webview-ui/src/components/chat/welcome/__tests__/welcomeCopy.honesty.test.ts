import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The static welcome CRA copy (CraNudge + the craCheck strings in welcomeIntents) is NOT covered by
// verdictScan — that scanner scopes to GENERATED CRA output, not source UI strings. Lock the doctrine-pass
// here so a future copy edit can't slip a conformity verdict / status glyph / numeric grade into the welcome
// surface, and so "secure-by-design" never stands alone as an attained state.
// cwd is the webview-ui package root when vitest runs (import.meta.url is vite-transformed, not a file URL).
const welcomeDir = join(process.cwd(), "src", "components", "chat", "welcome")
const text = ["CraNudge.tsx", "welcomeIntents.ts"].map((f) => readFileSync(join(welcomeDir, f), "utf8")).join("\n")

describe("welcome CRA copy — honesty doctrine lock", () => {
	it("no conformity-verdict words", () => {
		expect(text).not.toMatch(/\b(non-compliant|compliant|certified|conformant)\b/i)
	})

	it("no status glyphs or numeric grades", () => {
		expect(text).not.toMatch(/✅|⚠️|❌/)
		expect(text).not.toMatch(/\b\d+\s*\/\s*10\b/)
	})

	it("'secure-by-design' always carries the preview/posture hedge (never an attained state)", () => {
		const offending = text.split("\n").filter((l) => /secure-by-design/i.test(l) && !/preview|posture/i.test(l))
		expect(offending).toEqual([])
	})
})
