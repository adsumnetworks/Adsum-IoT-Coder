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

	it("recovers a FLAT real-space flowchart (the CRA per-step progress diagram the model flattened)", () => {
		// The model emitted the whole per-step diagram on one line with real spaces (no \n) → mermaid couldn't
		// parse it and it rendered as raw text. Re-introduce the breaks mermaid needs.
		const flat =
			"flowchart LR s1([1·SBOM]):::done --> s2([2·Scan]):::active --> s3([3·Posture]) classDef done stroke:#2fd4d4; classDef active stroke:#2fd4d4,stroke-width:2px;"
		const out = normalizeMermaidSource(flat)
		const lines = out.split("\n")
		expect(lines[0]).toBe("flowchart LR")
		// the node chain stays one line; each classDef gets its own line
		expect(out).toContain("s1([1·SBOM]):::done --> s2([2·Scan]):::active --> s3([3·Posture])")
		expect(out).toContain("\nclassDef done stroke:#2fd4d4")
		expect(out).toContain("\nclassDef active stroke:#2fd4d4,stroke-width:2px")
		expect(lines.length).toBeGreaterThanOrEqual(3)
	})

	it("recovers a flat 'class A,B,C step' statement onto its own line", () => {
		const flat = "flowchart LR A-->B classDef step stroke:#2fd4d4; class A,B step;"
		const out = normalizeMermaidSource(flat)
		expect(out).toContain("\nclass A,B step")
		expect(out).toContain("\nclassDef step stroke:#2fd4d4")
	})
})
