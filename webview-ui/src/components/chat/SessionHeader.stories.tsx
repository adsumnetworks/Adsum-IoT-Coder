import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import SessionHeader from "./SessionHeader"

const task: ClineMessage = { ts: 1, type: "say", say: "task", text: "Bring BLE NUS notifications up on the gateway" }

/**
 * [0.5 simple] The session tab's own header line: title (inline-editable), then one meta line — the
 * journey step when one is driving the turn, the tier (or the model, BYOK only), context-use, and
 * tokens or cost. The free tier shows tokens, never a dollar figure, since the developer paid nothing;
 * BYOK shows a cost only once its own provider actually reports one.
 */
const meta: Meta<typeof SessionHeader> = {
	title: "Session/SessionHeader",
	component: SessionHeader,
	decorators: [createStorybookDecorator({ apiConfiguration: { actModeApiProvider: "adsum-free" }, mode: "act" } as any)],
	parameters: {
		docs: {
			description: {
				component: "Title, then one meta line: journey step, tier/model, context-use, tokens or cost.",
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
		// Free tier: tokens, never a dollar figure — the developer paid nothing for these.
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
		// The developer's own key, their own provider's bill — a real cost, so it shows.
		totalCost: 2.37,
		view: "session",
	},
}

export const ByokNoCostReported: Story = {
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
		// This provider has not reported a cost yet — neither tokens (not Adsum's spend to show) nor a
		// stale "$0" render.
		totalCost: 0,
		view: "session",
	},
}
