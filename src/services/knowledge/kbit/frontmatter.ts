/**
 * Frontmatter parsing — pure string ops, zero deps (so the runtime loaders can import
 * `stripFrontmatter` without pulling in zod / js-yaml). See iot-knowledge/KBIT-SPEC.md.
 */

export type Frontmatter = { found: boolean; closed: boolean; yaml: string; body: string }

/** Extract ONLY the leading `---…---` block (mid-file `---` dividers are body, not frontmatter). */
export function extractFrontmatter(text: string): Frontmatter {
	const lines = text.split(/\r?\n/)
	if (lines[0]?.trim() !== "---") {
		return { found: false, closed: false, yaml: "", body: text }
	}
	const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---")
	if (closeIdx === -1) {
		return { found: true, closed: false, yaml: "", body: text }
	}
	return {
		found: true,
		closed: true,
		yaml: lines.slice(1, closeIdx).join("\n"),
		body: lines.slice(closeIdx + 1).join("\n"),
	}
}

/**
 * Return the bit body with a leading K-bit frontmatter block removed. Used by the runtime
 * loaders so a migrated bit's YAML metadata never enters the LLM prompt. A leading newline
 * (the blank line authors put after the closing `---`) is trimmed for clean injection.
 * If there is no (closed) frontmatter, the text is returned unchanged.
 */
export function stripFrontmatter(text: string): string {
	const fm = extractFrontmatter(text)
	return fm.found && fm.closed ? fm.body.replace(/^\r?\n/, "") : text
}
