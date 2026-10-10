import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import SessionHeader from "./SessionHeader"

const task: ClineMessage = { ts: 1, type: "say", say: "task", text: "Bring BLE NUS notifications up on the gateway" }

/**
 * [P4.1 sessions first] The session tab's own header line: title (inline-editable), the journey step
 * banner when a journey k-bit's prompt is driving the turn, the model chip, context-use, and a cost that
 * is Adsum's own free-tier spend — never a BYOK developer's.
 */
const meta: Meta<typeof SessionHeader> = {
	title: "Session/SessionHeader",
	component: SessionHeader,
	decorators: [createStorybookDecorator({ apiConfiguration: { actModeApiProvider: "adsum-free" }, mode: "act" } as any)],
	parameters: {
		docs: {
			description: {
				component: "Title, the journey banner, the model chip, context-use, and cost (free tier only).",
			},
		},
	},
}

export default meta
type Story = StoryObj<typeof SessionHeader>

export const NewSession: Story = {
	args: {
		messages: [task],
		task,
		totalCost: 0,
		view: "session",
	},
}

export const MidJourneyStep3of7: Story = {
	args: {
		lastApiReqTotalTokens: 48_000,
		messages: [
			task,
			{
				ts: 2,
				type: "say",
				say: "text",
				text: "### Step 3/7\n\nFlashing the application core...",
			},
		],
		task,
		totalCost: 0.0421,
		view: "session",
	},
}

export const Byok: Story = {
	decorators: [
		createStorybookDecorator({
			apiConfiguration: { actModeApiProvider: "anthropic", actModeApiModelId: "claude-sonnet-5-20261001" },
			mode: "act",
		} as any),
	],
	args: {
		lastApiReqTotalTokens: 120_000,
		messages: [task],
		task,
		// A non-zero total on a BYOK key never renders — Adsum did not run these tokens.
		totalCost: 2.37,
		view: "session",
	},
}
