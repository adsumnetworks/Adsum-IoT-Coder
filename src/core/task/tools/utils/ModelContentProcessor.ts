import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"

/**
 * File extensions that use escaped characters (&lt; &gt; &amp;) as valid syntax.
 * Add more extensions as needed (e.g., ".svg", ".xsd", ".xslt")
 */
const ESCAPED_CHARACTER_EXTENSIONS = [".xml"] as const

/**
 * Applies model-specific content fixes to handle quirks from non-Claude models.
 * Fixes escaped character issues and removes invalid characters.
 * Files using escaped characters as syntax (e.g., XML) are exempted from fixing.
 *
 * @param text The content to process
 * @param modelId The model ID to check if fixes are needed (optional - if not provided, applies fixes)
 * @param filePath The file path to determine if it uses escaped characters (optional)
 * @returns The processed content
 */
/**
 * H2 (0607 runs — the recurring "mermaid fence lost at the write step"): strip a full-file markdown-codeblock
 * WRAPPER that weaker models (deepseek/llama) sometimes add around file content — but ONLY a real wrapper.
 *
 * The inherited heuristic fired single-ended (`startsWith`/`endsWith` independently), so any legitimate
 * markdown file whose last line is a closing ``` — exactly how a CRA report ends (the posture-map mermaid
 * block) — had that fence EATEN at the write seam. Three real runs shipped/repaired broken diagrams this way.
 *
 * New rule — strip the first and last lines ONLY when they form a whole-file wrapper:
 *  - first line is a bare opening fence (```` ``` ```` or ```` ```lang ````),
 *  - last non-empty line is exactly ```` ``` ````,
 *  - and the INTERIOR fence lines are balanced (even count) — so a document that legitimately contains
 *    fenced blocks (```mermaid …```) is never mistaken for a wrapper of itself.
 * Anything else is returned byte-exact.
 */
export function stripFullFileCodeFenceWrapper(text: string): string {
	const lines = text.split("\n")
	// locate last non-empty line (models often end with a trailing newline)
	let last = lines.length - 1
	while (last >= 0 && lines[last].trim() === "") {
		last--
	}
	if (last <= 0) {
		return text
	}
	const first = lines[0].trim()
	if (!/^```[\w-]*$/.test(first) || lines[last].trim() !== "```") {
		return text
	}
	const interiorFences = lines.slice(1, last).filter((l) => l.trim().startsWith("```")).length
	if (interiorFences % 2 !== 0) {
		return text
	}
	return lines.slice(1, last).join("\n").trim()
}

export function applyModelContentFixes(text: string, modelId?: string, filePath?: string): string {
	if (modelId?.includes("claude")) {
		return text
	}

	const usesEscapedCharacters = ESCAPED_CHARACTER_EXTENSIONS.some((ext) => filePath?.toLowerCase().endsWith(ext))

	let processed = text

	if (!usesEscapedCharacters) {
		processed = fixModelHtmlEscaping(processed)
	}

	processed = removeInvalidChars(processed)

	return processed
}
