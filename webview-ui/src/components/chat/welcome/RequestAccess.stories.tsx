import type { Meta, StoryObj } from "@storybook/react-vite"
import { KbitLockedRow } from "@/components/chat/KbitLockedRow"
import AccountSection from "@/components/settings/sections/AccountSection"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import RequestAccessForm from "./RequestAccessForm"

/** Screens 6, 7 and 8 — asking for what a free account does not give you, and the two doors out. */

const signedIn = {
	adsumAccount: {
		email: "ismail@adsumnetworks.com",
		name: "Ismail",
		emailVerified: true,
		groups: ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"],
		openRequests: [],
	},
} as never

const meta: Meta = {
	title: "Adsum/RequestAccess",
	parameters: { layout: "fullscreen" },
}
export default meta

const withState = (value: unknown, node: React.ReactNode) => (
	<ExtensionStateContext.Provider value={value as never}>
		<div style={{ position: "relative", width: "100%", minHeight: "600px", padding: "12px" }}>{node}</div>
	</ExtensionStateContext.Provider>
)

export const Form: StoryObj = {
	render: () => withState(signedIn, <RequestAccessForm onClose={() => {}} open={true} />),
}

export const AccountSignedIn: StoryObj = {
	render: () => withState(signedIn, <AccountSection renderSectionHeader={() => null} />),
}

export const AccountSignedOut: StoryObj = {
	render: () => withState({}, <AccountSection renderSectionHeader={() => null} />),
}

export const LockedRow: StoryObj = {
	render: () =>
		withState(
			{},
			<div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "620px" }}>
				<KbitLockedRow
					bit={{
						id: "adsum/nrf/protocols/lte-attach",
						title: "nRF91 LTE attach & APN recipes",
						author: "Omar El Sayed",
						group: "cellular-advanced",
					}}
					onRegister={() => {}}
				/>
				<KbitLockedRow
					bit={{
						id: "adsum/nrf/protocols/lte-attach",
						title: "nRF91 LTE attach & APN recipes",
						author: "Omar El Sayed",
						revoked: true,
					}}
					onRequestAccess={() => {}}
				/>
			</div>,
		),
}
