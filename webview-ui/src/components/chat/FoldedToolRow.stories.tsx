import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { foldRows } from "@/utils/foldRows"
import FoldedToolRow from "./FoldedToolRow"

const renderMessage = (m: ClineMessage) => (
	<div className="text-[12px] py-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
		{m.text}
	</div>
)

/**
 * [P4.2 sessions first] One worklog line per folded tool/command/kbit run — collapsed by default, a
 * click expands, collapsing never deletes. An ask or an error (see the Exception story) always renders
 * in full; it never gets fold chrome.
 */
const meta: Meta<typeof FoldedToolRow> = {
	title: "Session/FoldedToolRow",
	component: FoldedToolRow,
	parameters: {
		docs: {
			description: {
				component: "The pure `foldRows` helper feeding a collapsible worklog line.",
			},
		},
	},
}

export default meta
type Story = StoryObj<typeof FoldedToolRow>

export const ReadFiles: Story = {
	args: {
		renderMessage,
		row: foldRows([
			{ ts: 1, type: "say", say: "tool", text: JSON.stringify({ tool: "readFile", path: "src/main.c" }) },
			{ ts: 2, type: "say", say: "tool", text: JSON.stringify({ tool: "readFile", path: "src/ble.c" }) },
			{ ts: 3, type: "say", say: "tool", text: JSON.stringify({ tool: "readFile", path: "src/ble.h" }) },
		])[0],
	},
}

export const RanACommand: Story = {
	args: {
		renderMessage,
		row: foldRows([{ ts: 1, type: "say", say: "command", text: "west build -b nrf9151dk/nrf9151/ns" }])[0],
	},
}

export const FlashedTheBoard: Story = {
	args: {
		renderMessage,
		row: foldRows([
			{ ts: 1, type: "say", say: "command", text: "nrfutil device program --firmware app.hex nrf9151 v0.3.3" },
		])[0],
	},
}

export const LoadedAKbit: Story = {
	args: {
		renderMessage,
		row: foldRows([
			{
				ts: 1,
				type: "say",
				say: "kbit_loaded",
				text: JSON.stringify({ id: "flash-nrf91", title: "flash the nRF9151", author: "J. Steward", kind: "knowledge" }),
			},
		])[0],
	},
}

export const Exception: Story = {
	args: {
		renderMessage,
		row: foldRows([{ ts: 1, type: "say", say: "error", text: "nrfutil device program failed: no DFU target found" }])[0],
	},
	parameters: {
		docs: {
			description: {
				story: "An error (or an ask) never folds — it renders in full, with no toggle at all.",
			},
		},
	},
}
