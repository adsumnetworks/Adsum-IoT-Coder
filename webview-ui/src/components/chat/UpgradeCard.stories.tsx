import type { Meta, StoryObj } from "@storybook/react-vite"
import UpgradeCard from "./UpgradeCard"

/**
 * The release card, fed from RELEASE_NOTES, so the contact-sheet sweep renders this release's copy on
 * screen in both themes. Two states: a user who can still take the release's one action, and one who
 * already has (dismiss-only).
 */
const meta: Meta<typeof UpgradeCard> = {
	title: "Chat/UpgradeCard",
	component: UpgradeCard,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div style={{ width: 420 }}>
				<Story />
			</div>
		),
	],
	args: { onDismiss: () => {} },
}
export default meta

export const Anonymous: StoryObj<typeof UpgradeCard> = { args: { onAction: () => {} } }
export const Registered: StoryObj<typeof UpgradeCard> = { args: { onAction: undefined } }
