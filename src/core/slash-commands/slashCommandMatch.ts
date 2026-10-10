/**
 * [0.5 slash commands anywhere] A `/command` token is recognised wherever it sits in the message,
 * not only at the very start — start, middle or end all count, as long as the slash is at a word
 * boundary (start of string or preceded by whitespace) and followed by whitespace or the end of
 * the string. A fenced code block is never searched: a slash a model is showing as an example, or
 * quoting from a log, is not an instruction.
 */

// Pattern breakdown: /(^|\s)\/([a-zA-Z0-9_.-]+)(?=\s|$)/
//   - (^|\s)  : Must be at start of string OR preceded by whitespace
//   - \/      : The literal slash character
//   - ([a-zA-Z0-9_.-]+) : The command name (letters, numbers, underscore, dot, hyphen)
//   - (?=\s|$): Must be followed by whitespace or end of string (lookahead)
//
// This safely avoids false matches in:
//   - URLs: "http://example.com/newtask" - slash not preceded by whitespace
//   - File paths: "some/path/newtask" or "/dev/ttyACM3" - a slash followed by another path
//     segment is never at a word boundary on both sides, so the lookahead fails
//   - Partial words: "foo/bar" - same reason
const SLASH_COMMAND_REGEX = /(^|\s)\/([a-zA-Z0-9_.-]+)(?=\s|$)/g

/** A ``` opens or closes a fenced block; an odd number left open runs to the end of the text. */
function fencedRanges(text: string): Array<[number, number]> {
	const fenceStarts: number[] = []
	const fence = /```/g
	let hit: RegExpExecArray | null
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex-loop idiom
	while ((hit = fence.exec(text))) {
		fenceStarts.push(hit.index)
	}

	const ranges: Array<[number, number]> = []
	for (let i = 0; i + 1 < fenceStarts.length; i += 2) {
		ranges.push([fenceStarts[i], fenceStarts[i + 1] + 3])
	}
	if (fenceStarts.length % 2 === 1) {
		ranges.push([fenceStarts[fenceStarts.length - 1], text.length])
	}
	return ranges
}

function isWithin(index: number, ranges: Array<[number, number]>): boolean {
	return ranges.some(([start, end]) => index >= start && index < end)
}

/**
 * Finds the first `/command` token in `text` that is outside any fenced code block.
 * Returns a match shaped like the underlying regex exec: group 1 is the leading whitespace
 * (or empty string at the very start), group 2 is the command name.
 */
export function findSlashCommandMatch(text: string): RegExpExecArray | null {
	const ranges = fencedRanges(text)
	const regex = new RegExp(SLASH_COMMAND_REGEX.source, SLASH_COMMAND_REGEX.flags)

	let match: RegExpExecArray | null
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex-loop idiom
	while ((match = regex.exec(text))) {
		const slashIndex = match.index + match[1].length
		if (!isWithin(slashIndex, ranges)) {
			return match
		}
		// the matched command itself can never be empty (one or more chars required), so
		// lastIndex has always moved forward and this loop terminates
	}
	return null
}
