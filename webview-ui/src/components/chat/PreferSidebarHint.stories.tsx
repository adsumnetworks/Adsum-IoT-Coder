import type { Meta, StoryObj } from "@storybook/react-vite"
import PreferSidebarHint from "./PreferSidebarHint"

/**
 * [0.5 sessions first] The one-line hint above the composer in a brand-new session tab. See the
 * component doc comment for why its dismiss has no localStorage key.
 */
const meta: Meta<typeof PreferSidebarHint> = {
	title: "Session/PreferSidebarHint",
	component: PreferSidebarHint,
	args: { view: "session" },
}

export default meta
type Story = StoryObj<typeof PreferSidebarHint>

export const EmptyTab: Story = {}

export const HiddenInTheSidebar: Story = {
	args: { view: "sidebar" },
	parameters: {
		docs: { description: { story: "Renders nothing — this hint only ever shows above a session tab's own composer." } },
	},
}
