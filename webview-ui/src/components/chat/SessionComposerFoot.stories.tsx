import type { Meta, StoryObj } from "@storybook/react-vite"
import SessionComposerFoot from "./SessionComposerFoot"

/**
 * [P3.3 sessions first] The permanent foot line under a session tab's composer. Session-view only — see
 * the component doc comment for why the rail (sidebar) never renders it.
 */
const meta: Meta<typeof SessionComposerFoot> = {
	title: "Session/SessionComposerFoot",
	component: SessionComposerFoot,
	parameters: {
		docs: {
			description: {
				component:
					"The ◆ mark, the open folder, the context-use percentage when known, and the 'Something else · ⌘K' handle that starts a fresh session.",
			},
		},
	},
}

export default meta
type Story = StoryObj<typeof SessionComposerFoot>

export const NewSession: Story = {
	args: {
		folderName: "gateway-fw",
		view: "session",
	},
}

export const MidTask: Story = {
	args: {
		folderName: "gateway-fw",
		contextPercent: 42.6,
		view: "session",
	},
}

export const NearContextLimit: Story = {
	args: {
		folderName: "lew840x-bench",
		contextPercent: 91.2,
		view: "session",
	},
}

export const HiddenInTheSidebar: Story = {
	args: {
		folderName: "gateway-fw",
		view: "sidebar",
	},
	parameters: {
		docs: {
			description: {
				story: "Renders nothing — the composer foot line never shows in the sidebar (the rail) view.",
			},
		},
	},
}
