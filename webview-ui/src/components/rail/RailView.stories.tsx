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

const Wrapped = ({
	state,
	page,
	palette,
	width = 420,
}: {
	state: Record<string, unknown>
	page?: "home" | "settings" | "sessions" | "hardware"
	palette?: boolean
	width?: number
}) => {
	const real = useExtensionState()
	return (
		<ExtensionStateProviderMock value={{ ...real, ...base, ...state } as never}>
			<div style={{ width, minHeight: 820, background: "var(--vscode-sideBar-background)" }}>
				<RailView initialPage={page} initialPalette={palette} />
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
export const FreeTierSpent: Story = { args: { state: { freeTierRemainingTokens: 0, quota: { kind: "spent", remaining: 0 } } } }
export const FreeTierPaused: Story = {
	args: {
		state: {
			freeTierRemainingTokens: 2_100_000,
			quota: { kind: "limited", remaining: 2_100_000, resetsAt: new Date(Date.now() + 15 * 60_000).toISOString() },
		},
	},
}
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

const blg20 = {
	status: "ready",
	extensionPresent: true,
	nrfutilPresent: true,
	boards: [],
	blg20Units: [{ serialNumber: "9802AF5C69DF1E66", servicePort: "/dev/tty.usbmodem2861", name: "286C", confirmed: true }],
	projectSdk: { version: "3.2.1", source: "workspace" },
}
export const PaletteOpen: Story = { args: { palette: true, state: { nrfEnvironment: blg20 } } }
export const HardwarePageOpen: Story = { args: { page: "hardware", state: { nrfEnvironment: blg20 } } }
export const AllSessionsPage: Story = {
	args: {
		page: "sessions",
		state: {
			taskHistory: [
				history("a", 2, "LEW840x gateway build", { title: "LEW840x gateway build", isFavorited: true }),
				history("b", 26, "NUS throughput drop"),
				history("c", 72, "CRA posture, first pass"),
				history("d", 200, "BLG20x 286C · set it up", { cwdOnTaskInitialization: "/Users/dev/sensor-node" }),
			],
		},
	},
}
export const SettingsPage: Story = { args: { page: "settings", state: {} } }
/** The narrowest sidebar VS Code allows is about 170 px; 260 is a common one. Nothing may overflow. */
export const NarrowSidebar: Story = {
	args: {
		width: 260,
		state: {
			nrfEnvironment: blg20,
			taskHistory: [
				history("a", 2, "LEW840x gateway build with a very long title that keeps going", {
					title: "LEW840x gateway build with a very long title that keeps going",
				}),
			],
			openSessions: [{ taskId: "a", title: "LEW840x gateway build", waiting: true, streaming: false, active: false }],
		},
	},
}
export const Offline: Story = { args: { state: { hostOffline: true, nrfEnvironment: blg20 } } }
export const NarrowSettings: Story = { args: { width: 260, page: "settings", state: { freeTierRemainingTokens: 76_488_063 } } }
export const NarrowHardware: Story = { args: { width: 260, page: "hardware", state: { nrfEnvironment: blg20 } } }

/**
 * [10 Oct 2026] The LBG20x, whose USB-C carries power only, reached over Bluetooth: the rows as the service tool's scan
 * reports them on the bench (unit AD50, paired from Linux; macOS does not say whether it is paired).
 */
const lbg20Ble = {
	via: "ble",
	family: "lbg20x",
	confirmed: true,
	name: "AD50",
	bleAddress: "D3:58:8E:7A:AD:50",
	bleId: "D3588E7AAD50",
	bonded: true,
	windowOpen: true,
	rssi: -64,
}
const lbg20 = {
	status: "ready",
	extensionPresent: true,
	nrfutilPresent: true,
	boards: [],
	blg20Units: [lbg20Ble],
	projectSdk: { version: "3.4.0", source: "workspace" },
}
export const Lbg20OverBluetooth: Story = {
	args: {
		state: {
			nrfEnvironment: lbg20,
			taskHistory: [history("a", 3, "LBG20x AD50 · read the passport")],
		},
	},
}
/** A unit seen earlier whose commissioning window has closed: dim, with what opens it. */
export const Lbg20WindowClosed: Story = {
	args: { state: { nrfEnvironment: { ...lbg20, blg20Units: [{ ...lbg20Ble, windowOpen: false, rssi: undefined }] } } },
}
/** Both gateways on one desk: the BLG20x on its cable, the LBG20x over Bluetooth. */
export const TwoGatewaysTwoDoors: Story = {
	args: {
		state: {
			nrfEnvironment: {
				...lbg20,
				blg20Units: [
					{
						via: "usb",
						family: "blg20x",
						serialNumber: "9802AF5C69DF1E66",
						servicePort: "/dev/tty.usbmodem2861",
						name: "286C",
						confirmed: true,
					},
					lbg20Ble,
				],
			},
		},
	},
}
export const HardwarePageLbg20OverBluetooth: Story = { args: { page: "hardware", state: { nrfEnvironment: lbg20 } } }

/**
 * [11 Oct 2026] The Hardware page's fourth step: AD50 as the bench read it (commissioned, the unit still checking its
 * first send), and a unit not commissioned yet. One action each, in words; the long facts behind (i).
 */
const lbg20Commissioned = {
	...lbg20Ble,
	paired: true,
	claimed: true,
	mine: true,
	bleFw: "0.3.6",
	lteFw: "0.2.8",
	latest: { version: "1.0.0", bleFw: "0.3.6", lteFw: "0.2.8", newer: false },
	commission: {
		commissioned: true,
		line: "commissioned · 53.24508, -1.44321 ±14 m · sends over LTE-M · MQTT without TLS to broker.emqx.io",
		verdict: { state: "warn", words: "Still checking: a first send can take a few minutes; read the status again." },
		window: "open, closes 3:52 after you disconnect",
	},
}
const lbg20NotCommissioned = {
	...lbg20Commissioned,
	commission: { commissioned: false, line: "not commissioned", window: "open (not commissioned, so it stays open)" },
}
export const HardwarePageLbg20Commissioned: Story = {
	args: { page: "hardware", state: { nrfEnvironment: { ...lbg20, blg20Units: [lbg20Commissioned] } } },
}
export const HardwarePageLbg20Commissioned260: Story = {
	args: { width: 260, page: "hardware", state: { nrfEnvironment: { ...lbg20, blg20Units: [lbg20Commissioned] } } },
}
export const HardwarePageLbg20NotCommissioned: Story = {
	args: { page: "hardware", state: { nrfEnvironment: { ...lbg20, blg20Units: [lbg20NotCommissioned] } } },
}
