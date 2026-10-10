import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import ChatTextArea from "./ChatTextArea"

/**
 * [0.5 composer polish] The session composer's toolbar row: + (attach) and / (slash) lead the left side
 * with the model chip, the Plan/Act pill and the round cyan send button sit on the right. See the inline
 * comments in ChatTextArea.tsx (search "0.5 composer polish") for what was restyled in place versus newly
 * added.
 */
const meta: Meta<typeof ChatTextArea> = {
	title: "Session/ChatTextArea",
	component: ChatTextArea,
	decorators: [createStorybookDecorator({ apiConfiguration: { actModeApiProvider: "adsum-free" }, mode: "act" } as any)],
	args: {
		activeQuote: null,
		inputValue: "",
		onSelectFilesAndImages: fn(),
		onSend: fn(),
		placeholderText: "Say what you want done. ⌘⏎ sends, / for commands, @ to mention",
		selectedFiles: [],
		selectedImages: [],
		sendingDisabled: false,
		setInputValue: fn(),
		setSelectedFiles: fn(),
		setSelectedImages: fn(),
		shouldDisableFilesAndImages: false,
	},
}

export default meta
type Story = StoryObj<typeof ChatTextArea>

export const ActMode: Story = {}

export const PlanMode: Story = {
	decorators: [createStorybookDecorator({ apiConfiguration: { planModeApiProvider: "adsum-free" }, mode: "plan" } as any)],
}

export const Typed: Story = {
	args: { inputValue: "Build and flash the connected board, then stream the live logs" },
}
