import { dump as yamlDump } from "js-yaml"
import { type KBitMeta, kbitMetaSchema } from "./schema"

/**
 * Pure authoring helpers for the `kbit new|edit` wizard (scripts/kbit.ts) — the P1 authoring kit
 * (design: target-architecture/05-counters-and-authoring.md §3). No filesystem or prompts here, so
 * everything is unit-testable (node:test) and shares ONE schema with the linter/registry.
 */

/**
 * Validate a meta object against the canonical schema and render the leading YAML frontmatter block.
 * Throws a ZodError on invalid input (the CLI surfaces the issues) — the wizard can never emit a bit
 * that wouldn't lint.
 */
export function generateFrontmatter(meta: unknown): string {
	const parsed = kbitMetaSchema.parse(meta)
	const yaml = yamlDump(parsed, { lineWidth: 120, noRefs: true }).trimEnd()
	return `---\n${yaml}\n---\n`
}

/** House-style body skeleton per bit type. `basename` is the file name so the H1 names its own path. */
export function generateBody(meta: Pick<KBitMeta, "type" | "title">, basename: string): string {
	const h1 = `# ${meta.title} (${basename})`
	if (meta.type === "workflow") {
		return [
			h1,
			"",
			"**Triggered by:** <intent phrases — keep in sync with `triggers` in the frontmatter>",
			"",
			"## Steps",
			"1. <first step>",
			"2. <next step>",
			"",
			"## Skills this loads",
			"**MANDATORY SKILL LOAD:** read_file → <path/to/required/bit.md>  (also declare it as a `requires` id)",
			"",
			"## Honesty rules",
			"- Report real tool output; never fabricate a result or claim a step ran when it didn't.",
			"",
			"## Next step",
			'Offer the developer a button choice via ask_followup_question — never "type this".',
			"",
		].join("\n")
	}
	if (meta.type === "action") {
		return [
			h1,
			"",
			"## What it does",
			"<one-line description of this atomic operation>",
			"",
			"## How to run it",
			"1. <command / tool invocation>",
			"",
			"## Safety",
			"<any dangerous ops MUST be declared in the `safety` frontmatter (shell/flash/erase/…)>",
			"",
		].join("\n")
	}
	return [
		h1,
		"",
		"## Overview",
		"<reference knowledge — what an engineer needs to know>",
		"",
		"## Details",
		"<facts, tables, config snippets>",
		"",
	].join("\n")
}

/** The `bring-a-test` fixture stub (R1.3) — convention only in P1; execution lands in P4 (benchmark). */
export function generateTestStub(meta: Pick<KBitMeta, "id" | "type">): string {
	return [
		`# bring-a-test fixture for ${meta.id}`,
		"#",
		"# R1.3 — every bit ships >=1 verifying task. Harness execution lands in P4 (benchmark/ablation).",
		"",
		"- given: <starting project / state that exercises this bit>",
		`- when:  <the task prompt that should route to this ${meta.type}>`,
		"- then:  <observable success criterion the harness can check>",
		"",
	].join("\n")
}

/** Convenience: the full bit file (validated frontmatter + body skeleton). */
export function composeBit(meta: KBitMeta, basename: string): string {
	return `${generateFrontmatter(meta)}\n${generateBody(meta, basename)}`
}
