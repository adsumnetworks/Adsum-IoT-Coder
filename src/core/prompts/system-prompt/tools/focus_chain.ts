import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

// Also acts as the tool-registry dependency gate for TASK_PROGRESS_PARAMETER: other tools only
// keep their task_progress parameter when this id is present in the enabled-tool registry (see
// PromptBuilder.tool's dependency filter). Kept as a real, describable tool below so XML-mode
// models (GENERIC variant) still get a usable description instead of an empty entry.
const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.TODO,
	name: "focus_chain",
	description:
		"Records or revises the task progress checklist for the overall task. Use this when creating the checklist for the first time (for example, right after switching from PLAN MODE to ACT MODE) or when the scope has changed enough that the existing checklist is no longer accurate. For a routine progress update on a step you are already completing, prefer attaching the task_progress parameter directly to the tool call you are making instead of calling this tool on its own.",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
	parameters: [TASK_PROGRESS_PARAMETER],
}

export const focus_chain_variants = [generic]
