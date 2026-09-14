import type { Meta, StoryObj } from "@storybook/react-vite"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { KbitLockedRow } from "../KbitLockedRow"
import CellularGroup from "./CellularGroup"
import DemoHexCard from "./DemoHexCard"
import GatewayLadder from "./GatewayLadder"
import RequestAccessForm from "./RequestAccessForm"

/**
 * The BLG20x store surfaces, with the account state injected.
 *
 * These three states are DEFINED by what an account holds, and nothing is signed in on the bench —
 * signed out, the product correctly renders none of them, so there is nothing to photograph there.
 * Injecting the groups here shows the same components with the same code, and every shot taken from
 * this file is labelled as story-injected in the review so nobody mistakes it for the live bench.
 */

const withAccount = (groups: string[]) =>
	({
		adsumAccount: { email: "dev@example.com", name: "Dev", emailVerified: true, groups },
	}) as never

const frame = (groups: string[]) => [
	(Story: React.ComponentType) => (
		<ExtensionStateContext.Provider value={withAccount(groups)}>
			<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
				<Story />
			</div>
		</ExtensionStateContext.Provider>
	),
]

const meta: Meta = { title: "Adsum/StoreBits", parameters: { layout: "padded" } }
export default meta

const noop = () => {}
/* The two handlers the group actually calls. Typed, not cast: a cast here is how a story stops
   compiling with the component it is supposed to be showing. */
const handlers = { onStartTask: noop, onSelectMode: noop }

/** State 1 — the gateway cards with the board seen, for a developer the BLG20x is open for. */
export const HardwareHomeUnlocked: StoryObj = {
	decorators: frame(["cellular-advanced", "edge-ai-advanced", "blg20-early-access", "blg20-demo-hex"]),
	render: () => <CellularGroup boards={["Fanstel BLG20XE02C", "nRF9151"]} {...handlers} />,
}

/** State 1, signed out — every card that registering opens says so, and the one it does not, does not. */
export const HardwareHomeAnonymous: StoryObj = {
	decorators: [
		(Story: React.ComponentType) => (
			<ExtensionStateContext.Provider value={{} as never}>
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
					<Story />
				</div>
			</ExtensionStateContext.Provider>
		),
	],
	render: () => <CellularGroup boards={["Fanstel BLG20XE02C"]} {...handlers} />,
}

/** State 4 — an advanced set before anyone has asked for it. Nothing teased, one action. */
export const AdvancedSetBeforeAsking: StoryObj = {
	decorators: frame(["cellular-advanced", "blg20-demo-hex"]),
	render: () => (
		<>
			<KbitLockedRow
				bit={{
					id: "adv-full",
					title: "The advanced set — the whole board",
					author: "Ismail Hamdad",
					group: "blg20-adv-full",
					summary:
						"It knows this hardware, so you build the full gateway from scratch much faster. If you hold a licence it also knows the firmware, so you customise that much faster too.",
				}}
				onRequestAccess={noop}
			/>
			<KbitLockedRow
				bit={{
					id: "adv-ble",
					title: "The advanced set — the radio half",
					author: "Ismail Hamdad",
					group: "blg20-adv-ble",
					summary: "The same, for the cellular and satellite half of the board.",
				}}
				onRequestAccess={noop}
			/>
			{/* And the row registering DOES open, for the contrast the reader needs. */}
			<KbitLockedRow
				bit={{ id: "nrf91", title: "nRF91 modem bring-up", author: "Omar Morceli", group: "cellular-advanced" }}
				onRegister={noop}
			/>
		</>
	),
}

/** State 5 — installing the demo pair: the limits above the action, then what protects it. */
export const DemoPair: StoryObj = {
	decorators: frame(["blg20-demo-hex", "blg20-early-access"]),
	render: () => <DemoHexCard onFlash={noop} />,
}

/** The form behind every "Ask for more details", opened from a BLG20x card. */
export const AskForm: StoryObj = {
	decorators: frame(["blg20-demo-hex", "blg20-early-access"]),
	render: () => <RequestAccessForm family="blg20" onClose={noop} open={true} />,
}

/*
 * The same board, the same card, four accounts.
 *
 * The one that matters is the partner: an engineer with the demo pair and the advanced knowledge for
 * this board and nothing else. What they must see is the demo they can run and, on everything else,
 * one ask — never a hint that the source or the production image is theirs or nearly theirs.
 */
const REGISTERED = ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"]
const PARTNER = [...REGISTERED, "blg20-demo-hex", "blg20-adv-ble", "blg20-adv-full"]

const ladderFor = (groups: string[] | null) => {
	const value = groups ? withAccount(groups) : ({} as never)
	return {
		decorators: [
			(Story: React.ComponentType) => (
				<ExtensionStateContext.Provider value={value}>
					<div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "12px" }}>
						<Story />
					</div>
				</ExtensionStateContext.Provider>
			),
		],
		render: () => (
			<>
				<GatewayLadder boards={["Fanstel BLG20XE02C"]} onAsk={noop} onInstall={noop} onStart={noop} />
				{/* A locked row only for an account that does NOT hold the set — a holder would simply
				    read the bit, and a story that shows them a lock teaches the reviewer the wrong thing. */}
				{!(groups ?? []).some((g) => g === "all" || g.startsWith("blg20-adv")) && (
					<KbitLockedRow
						bit={{
							id: "adv-full",
							title: "The advanced set — the whole board",
							author: "Ismail Hamdad",
							group: "blg20-adv-full",
							summary: "It knows this hardware, so you build the full gateway from scratch much faster.",
						}}
						onRequestAccess={noop}
					/>
				)}
				{/* The register row belongs ONLY to the signed-out state: registering is all-or-nothing,
				    so an account that exists can never be told a bit "needs a registered account". */}
				{!groups && (
					<KbitLockedRow
						bit={{ id: "nrf91", title: "nRF91 modem bring-up", author: "Omar Morceli", group: "cellular-advanced" }}
						onRegister={noop}
					/>
				)}
			</>
		),
	}
}

/** Nobody signed in. */
export const LadderAnonymous: StoryObj = ladderFor(null)
/** An account that has registered and been granted nothing beyond the tier. */
export const LadderRegistered: StoryObj = ladderFor(REGISTERED)
/** The partner engineer: the demo pair and the advanced knowledge for this board, and nothing else. */
export const LadderPartner: StoryObj = ladderFor(PARTNER)
/** A holder of everything, for the contrast. */
export const LadderEverything: StoryObj = ladderFor(["all"])

/** A production-licence holder: the production rung does the thing instead of asking about it. */
export const LadderProduction: StoryObj = ladderFor([...REGISTERED, "blg20-demo-hex", "blg20-prod-hex"])
/** One half of the source only — the words say which half is theirs, and the other is still an ask. */
export const LadderRadioHalf: StoryObj = ladderFor([...REGISTERED, "blg20-demo-hex", "blg20-9151-src"])
