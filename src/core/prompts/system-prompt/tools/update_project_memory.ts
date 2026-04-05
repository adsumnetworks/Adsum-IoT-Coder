import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.UPDATE_MEMORY

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: id,
	description:
		"Securely updates the persistent Memory Heartbeat files for the current workspace. Use this tool specifically to update `project.md`, `devices.md`, or `session.md` instead of standard file modification tools, as these files reside securely outside the project workspace.",
	parameters: [
		{
			name: "filename",
			required: true,
			instruction:
				"The name of the memory file to update. Must be exactly one of: 'project.md', 'devices.md', or 'session.md'.",
			usage: "session.md",
		},
		{
			name: "content",
			required: true,
			instruction: "The full updated content to save to the memory file.",
			usage: "# Session Memory\\n\\nWe resolved the SPI timeout issue...",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: id,
	description:
		"Securely updates the persistent Memory Heartbeat files for the current workspace. Use this tool specifically to update `project.md`, `devices.md`, or `session.md` instead of standard file modification tools, as these files reside securely outside the project workspace.",
	parameters: [
		{
			name: "filename",
			required: true,
			instruction:
				"The name of the memory file to update. Must be exactly one of: 'project.md', 'devices.md', or 'session.md'.",
			usage: "session.md",
		},
		{
			name: "content",
			required: true,
			instruction: "The full updated content to save to the memory file.",
			usage: "# Session Memory\\n\\nWe resolved the SPI timeout issue...",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const update_project_memory_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
