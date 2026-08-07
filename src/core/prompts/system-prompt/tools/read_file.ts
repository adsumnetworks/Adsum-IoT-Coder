import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_READ

/**
 * Optional line window. Measured motivation: an agent read a 69,739-char sdkconfig whole *after*
 * search_files had already pinpointed the 570-char answer — because `path` was read_file's only
 * parameter. Shared by every variant so the XML prompt and the native JSON schema stay identical.
 */
const START_LINE_PARAMETER = {
	name: "start_line",
	required: false,
	type: "integer" as const,
	instruction: `(optional) First line to read, 1-based and inclusive. Use a line range whenever you already know roughly where the answer is — most importantly right after search_files reported a match at a line number (read a window around it instead of the whole file), and for large configuration or build artifacts (sdkconfig, .config, build_info.yml, generated headers, map files, logs) where reading everything would flood your context. Omit both start_line and end_line to read the whole file.`,
	usage: "Start line number here (optional, e.g. 120)",
}

const END_LINE_PARAMETER = {
	name: "end_line",
	required: false,
	type: "integer" as const,
	instruction: `(optional) Last line to read, 1-based and inclusive. Values past the end of the file are clamped, so asking for a generous window is safe. The response is annotated with the exact range returned and the file's total line count, so you can request a further window if the region you need extends beyond it. Omit both start_line and end_line to read the whole file.`,
	usage: "End line number here (optional, e.g. 180)",
}

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_file",
	description:
		"Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string. Do NOT use this tool to list the contents of a directory. Only use this tool on files. Supports partial reads: pass the optional start_line/end_line parameters to read only a window of the file — prefer a range over a whole-file read once search_files has located the region you care about, and for large configuration or build artifacts.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to read (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		START_LINE_PARAMETER,
		END_LINE_PARAMETER,
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "read_file",
	description:
		"Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string. Do NOT use this tool to list the contents of a directory. Only use this tool on files. Supports partial reads: pass the optional start_line/end_line parameters to read only a window of the file — prefer a range over a whole-file read once search_files has located the region you care about, and for large configuration or build artifacts.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to read (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		START_LINE_PARAMETER,
		END_LINE_PARAMETER,
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_file_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
