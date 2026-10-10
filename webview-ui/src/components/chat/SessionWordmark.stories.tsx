import type { Meta, StoryObj } from "@storybook/react-vite"
import SessionWordmark from "./SessionWordmark"

/**
 * [0.5 sessions first] The mark and name at the top of a brand-new session tab. See the component doc
 * comment for why it disappears once a task exists, and for why the sidebar never renders it.
 */
const meta: Meta<typeof SessionWordmark> = {
	title: "Session/SessionWordmark",
	component: SessionWordmark,
	args: { view: "session" },
}

export default meta
type Story = StoryObj<typeof SessionWordmark>

export const EmptyTab: Story = {}

export const HiddenInTheSidebar: Story = {
	args: { view: "sidebar" },
	parameters: {
		docs: {
			description: {
				story: "Renders nothing — the wordmark only ever shows at the top of an empty session tab.",
			},
		},
	},
}
