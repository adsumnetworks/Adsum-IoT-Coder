import type { Meta, StoryObj } from "@storybook/react-vite"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import GatePanel from "./GatePanel"

/**
 * The gate's three states — screen 3 and screen 10 of the approved mockup.
 *
 * Three, because there are exactly three honest things that can be true at this point: we can ask,
 * we cannot reach the network, or we are waiting on a verification email. Each names what happened
 * and what the developer can do next. None of them is a spinner.
 */
const meta: Meta<typeof GatePanel> = {
	title: "Adsum/GatePanel",
	component: GatePanel,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<ExtensionStateContext.Provider value={{} as never}>
				<div style={{ position: "relative", width: "100%", height: "560px" }}>
					<Story />
				</div>
			</ExtensionStateContext.Provider>
		),
	],
}
export default meta
type Story = StoryObj<typeof GatePanel>

export const Default: Story = { args: { open: true, onClose: () => {}, surface: "card" } }
export const Offline: Story = { args: { open: true, variant: "offline", onClose: () => {} } }
export const VerifyPending: Story = {
	args: { open: true, variant: "verify", email: "ismail@adsumnetworks.com", onClose: () => {} },
}
