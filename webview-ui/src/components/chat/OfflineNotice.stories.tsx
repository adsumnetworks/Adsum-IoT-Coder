import type { Meta, StoryObj } from "@storybook/react-vite"
import OfflineNotice from "./OfflineNotice"

/**
 * [P4.9 sessions first] One line at the top of the session when the host reports the model's API
 * unreachable. `hostOffline` is new on `ExtensionState` (src/shared/ExtensionMessage.ts) — nothing on
 * the host populates it yet, see the TODO there.
 */
const meta: Meta<typeof OfflineNotice> = {
	title: "Session/OfflineNotice",
	component: OfflineNotice,
}

export default meta
type Story = StoryObj<typeof OfflineNotice>

export const Offline: Story = {
	args: { hostOffline: true },
}

export const Reachable: Story = {
	args: { hostOffline: false },
}
