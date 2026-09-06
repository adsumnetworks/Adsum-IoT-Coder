import type { Meta, StoryObj } from "@storybook/react-vite"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import AccountChip from "./AccountChip"
import DemoHexCard from "./DemoHexCard"
import UnlockedCard from "./UnlockedCard"

/**
 * The three post-registration pieces, on their own.
 *
 * They appear on the welcome surface inside a clipped column, so a contact sheet of that surface can
 * never show all three at once. These stories exist so each can be compared with the mockup on its
 * own terms — and so the account chip, which lives in the header, is visible at all.
 */
const account = {
	adsumAccount: { email: "ismail@adsumnetworks.com", name: "Ismail", emailVerified: true, groups: ["all"] },
} as never

const meta: Meta = {
	title: "Adsum/Registered",
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<ExtensionStateContext.Provider value={account}>
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px", maxWidth: "760px" }}>
					<Story />
				</div>
			</ExtensionStateContext.Provider>
		),
	],
}
export default meta

export const Chip: StoryObj = {
	render: () => (
		<div
			className="uppercase"
			style={{
				display: "flex",
				alignItems: "center",
				gap: "8px",
				fontSize: "10px",
				letterSpacing: "0.08em",
				color: "var(--vscode-descriptionForeground)",
			}}>
			<span>Environment</span>
			<AccountChip />
		</div>
	),
}

export const Unlocked: StoryObj = { render: () => <UnlockedCard onDismiss={() => {}} /> }
export const DemoHex: StoryObj = { render: () => <DemoHexCard onFlash={() => {}} /> }
export const DemoHexFlashing: StoryObj = {
	render: () => <DemoHexCard flashing="nRF9160 bearer… 2 of 3" onFlash={() => {}} />,
}
