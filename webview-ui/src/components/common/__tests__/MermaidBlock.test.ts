import { describe, expect, it } from "vitest"
import { normalizeMermaidSource } from "../MermaidBlock"

describe("normalizeMermaidSource", () => {
	it("converts literal \\n escapes to real newlines when the source is single-line", () => {
		// The model artifact: the whole diagram on one line with literal "\n".
		const src = "flowchart LR\\n  base --> sensor\\n  base --> nvs"
		const out = normalizeMermaidSource(src)
		expect(out).not.toContain("\\n")
		expect(out.split("\n")).toHaveLength(3)
	})

	it("also converts literal \\t escapes", () => {
		expect(normalizeMermaidSource("graph TD\\n\\tA-->B")).toContain("\t")
	})

	it("leaves a real multi-line source untouched (a label's literal \\n is preserved)", () => {
		const src = 'flowchart LR\n  a["line1\\nline2"] --> b'
		expect(normalizeMermaidSource(src)).toBe(src)
	})

	it("is a no-op for already-correct multi-line mermaid", () => {
		const src = "sequenceDiagram\n  A->>B: hi\n  B-->>A: yo"
		expect(normalizeMermaidSource(src)).toBe(src)
	})
})
