import type { HistoryItem } from "@shared/HistoryItem"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import RailView from "./RailView"

/**
 * [0.5 sessions first] The rail, state by state: the stories the screenshot rig walks in both themes. The
 * fixture mirrors the mockup's STATES so the mockup and the stories cannot drift apart.
 */
const ExtensionStateProviderMock = ExtensionStateContext.Provider

const base = {
	didHydrateState: true,
	version: "0.5.0",
	taskHistory: [] as HistoryItem[],
	openFolderPaths: ["/Users/dev/gateway-fw"],
	workspaceRoots: ["/Users/dev/gateway-fw"],
	workspaceClassification: "nrf" as const,
	workspaceFeatures: { hasBle: true, hasWifi: false, hasComplianceArtifacts: false },
	nrfEnvironment: {
		status: "ready",
		extensionPresent: true,
		nrfutilPresent: true,
		boards: [],
		blg20Units: [],
		projectSdk: { version: "3.2.1", source: "workspace" },
	},
	espEnvironment: { status: "ready", extensionPresent: false, idfPresent: false, espDevices: [] },
	apiConfiguration: { actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" },
	mode: "act",
	freeTierRemainingTokens: 6_600_000,
	adsumAccount: {
		email: "ismail@adsumnetworks.com",
		name: "Ismail",
		emailVerified: true,
		groups: ["cellular-advanced", "lora-advanced", "blg20-demo-hex"],
		openRequests: [],
	},
	openSessions: [],
	showSettings: false,
	showHistory: false,
	hideSettings: () => {},
	hideHistory: () => {},
	navigateToSettings: () => {},
	navigateToHistory: () => {},
}

const history = (id: string, hoursAgo: number, task: string, extra: Partial<HistoryItem> = {}): HistoryItem => ({
	id,
	ts: Date.now() - hoursAgo * 3600_000,
	task,
	tokensIn: 1000,
	tokensOut: 500,
	totalCost: 0,
	cwdOnTaskInitialization: "/Users/dev/gateway-fw",
	...extra,
})

const Wrapped = ({ state }: { state: Record<string, unknown> }) => {
	const real = useExtensionState()
	return (
		<ExtensionStateProviderMock value={{ ...real, ...base, ...state } as never}>
			<div style={{ width: 420, minHeight: 820, background: "var(--vscode-sideBar-background)" }}>
				<RailView />
			</div>
		</ExtensionStateProviderMock>
	)
}

const meta: Meta<typeof Wrapped> = { title: "Rail/Sidebar", component: Wrapped, parameters: { layout: "fullscreen" } }
export default meta
type Story = StoryObj<typeof Wrapped>

export const FirstRunNoFolder: Story = {
	args: {
		state: {
			openFolderPaths: [],
			workspaceRoots: [],
			workspaceClassification: "none",
			adsumAccount: undefined,
			nrfEnvironment: { status: "ready", extensionPresent: false, nrfutilPresent: false, boards: [] },
		},
	},
}
export const Blg20OnUsb: Story = {
	args: {
		state: {
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				boards: [],
				blg20Units: [
					{ serialNumber: "9802AF5C69DF1E66", servicePort: "/dev/tty.usbmodem2861", name: "286C", confirmed: true },
				],
			},
			taskHistory: [history("a", 48, "NUS throughput drop", { cwdOnTaskInitialization: "/Users/dev/sensor-node" })],
		},
	},
}
export const ReturningHere: Story = {
	args: {
		state: {
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				boards: [{ deviceName: "nRF52840 DK", productName: "nRF52840 DK", serialNumber: "683335182" }],
			},
			taskHistory: [
				history("a", 2, "LEW840x gateway build", { title: "LEW840x gateway build", isFavorited: true }),
				history("b", 26, "NUS throughput drop"),
				history("c", 72, "CRA posture, first pass"),
			],
		},
	},
}
export const TwoSessionsOpen: Story = {
	args: {
		state: {
			taskHistory: [
				history("a", 0.01, "LEW840x gateway build", { title: "LEW840x gateway build" }),
				history("b", 0.02, "BLG20x 286C · set it up"),
			],
			openSessions: [
				{ taskId: "a", title: "LEW840x gateway build", waiting: false, streaming: true, active: true },
				{ taskId: "b", title: "BLG20x 286C · set it up", waiting: true, streaming: false, active: false },
			],
		},
	},
}
export const FreeTierLow: Story = { args: { state: { freeTierRemainingTokens: 84_000 } } }
export const FreeTierSpent: Story = { args: { state: { freeTierRemainingTokens: 0 } } }
export const SignedOutLocked: Story = {
	args: {
		state: {
			adsumAccount: undefined,
			nrfEnvironment: {
				status: "ready",
				extensionPresent: true,
				nrfutilPresent: true,
				boards: [{ deviceName: "nRF9151 DK", productName: "nRF9151 DK", serialNumber: "105000001" }],
			},
		},
	},
}
export const SignInPending: Story = { args: { state: { adsumAccount: undefined, adsumSignInPending: true } } }
export const LicensedByok: Story = {
	args: {
		state: {
			apiConfiguration: { actModeApiProvider: "anthropic", actModeApiModelId: "claude-sonnet-5", apiKey: "x" },
			freeTierRemainingTokens: undefined,
			adsumAccount: {
				email: "ops@acme.example",
				name: "Ops",
				emailVerified: true,
				groups: ["cellular-advanced", "blg20-prod-hex"],
				openRequests: [],
			},
			openFolderPaths: ["/Users/dev/blg20-fleet"],
			workspaceRoots: ["/Users/dev/blg20-fleet"],
		},
	},
}
export const TwoFolders: Story = {
	args: {
		state: {
			openFolderPaths: ["/Users/dev/gateway-fw", "/Users/dev/esp-softap"],
			workspaceRoots: ["/Users/dev/gateway-fw", "/Users/dev/esp-softap"],
			taskHistory: [history("a", 2, "LEW840x gateway build")],
		},
	},
}
