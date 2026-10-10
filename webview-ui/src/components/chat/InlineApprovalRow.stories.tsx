import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import InlineApprovalRow from "./InlineApprovalRow"

const readTool: ClineMessage = {
	ts: 1,
	type: "ask",
	ask: "tool",
	text: JSON.stringify({ tool: "readFile", path: "src/ble_nus.c" }),
}

/**
 * [0.5 simple] Approvals as the exception path: Allow (primary pill) · Always allow (ghost, with an Info
 * naming the global setting it touches) · Deny (ghost) — inline, right under the ask, only while that
 * ask is the one actually waiting on an answer.
 */
const meta: Meta<typeof InlineApprovalRow> = {
	title: "Session/InlineApprovalRow",
	component: InlineApprovalRow,
	decorators: [
		createStorybookDecorator({
			autoApprovalSettings: {
				version: 1,
				enabled: true,
				favorites: [],
				maxRequests: 20,
				actions: {
					readFiles: true,
					editFiles: false,
					executeSafeCommands: true,
					executeAllCommands: false,
					useBrowser: false,
					useMcp: true,
				},
				enableNotifications: false,
			},
		} as any),
	],
}

export default meta
type Story = StoryObj<typeof InlineApprovalRow>

export const ReadApproval: Story = {
	args: { isLast: true, message: readTool },
}

export const CommandApproval: Story = {
	args: {
		isLast: true,
		message: { ts: 2, type: "ask", ask: "command", text: "nrfutil device program --firmware app.hex" },
	},
}

export const AlreadyAnswered: Story = {
	args: { isLast: false, message: readTool },
	parameters: {
		docs: {
			description: {
				story: "Not the live ask any more — a later message moved past it, so nothing renders.",
			},
		},
	},
}
