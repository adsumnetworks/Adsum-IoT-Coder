import type { Meta, StoryObj } from "@storybook/react-vite"
import WhatsNewCard from "./WhatsNewCard"

/**
 * [0.5 sessions first] The one-time "what moved" announcement under First steps in an empty session
 * tab. See the component doc comment for the dismiss contract.
 */
const meta: Meta<typeof WhatsNewCard> = {
	title: "Session/WhatsNewCard",
	component: WhatsNewCard,
}

export default meta
type Story = StoryObj<typeof WhatsNewCard>

export const Default: Story = {}
