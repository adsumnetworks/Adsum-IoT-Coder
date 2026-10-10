import type { HistoryItem } from "@shared/HistoryItem"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import FirmwareRungs, { type Entry, type FirmwareCall, FirmwareCallContext, type Row } from "./FirmwareRungs"
import RailView from "./RailView"

/**
 * [0.5 the firmware lane] The firmware rows of the Hardware page, one story per state, drawn with no host
 * behind them: the firmware op is replaced through its context. The entries mirror what the live registry
 * lists for a registered account (titles, rungs, groups, files), so the render is the product's.
 */
const FOLDER = "/Users/dev/gateway-fw/firmware/blg20x/1.0.0"

const blg20Demo: Entry = {
	id: "adsum/firmware/blg20x-demo-hex",
	version: "1.0.0",
	family: "blg20x",
	rung: "demo-hex",
	group: "blg20-demo-hex",
	title: "BLG20x demo pair",
	summary: null,
	security: false,
	released_at: "2026-10-09",
	entitled: true,
	licence: { id: "adsum-template-licence-demo", termMonths: 12 },
	artifacts: [
		{ path: "bm20/merged.hex", sha256: "71c5", size: 2_757_388 },
		{ path: "LICENSE-ADSUM.txt", sha256: "10e5", size: 480 },
		{ path: "nrf9151/merged.hex", sha256: "1b16", size: 1_299_386 },
		{ path: "usb/demo/ble.signed.bin", sha256: "b232", size: 880_304 },
		{ path: "usb/demo/lte.signed.bin", sha256: "dc53", size: 442_167 },
		{ path: "usb/release.json", sha256: "47ca", size: 535 },
	],
}

const blg20Production: Entry = {
	...blg20Demo,
	id: "adsum/firmware/blg20x-production",
	version: "2.3.0",
	rung: "production",
	group: "blg20-prod-hex",
	title: "BLG20x production",
	entitled: false,
	artifacts: [],
}

const lew840xDemo: Entry = {
	...blg20Demo,
	id: "adsum/firmware/lew840x-demo-hex",
	family: "lew840x",
	group: "lew840x-demo-hex",
	title: "LEW840x demo",
	released_at: "2026-09-14",
	artifacts: [],
}

const receipt = (status: "active" | "expired") => ({
	licensee: "dev@acme.example",
	term_end: status === "active" ? "2027-10-09T00:00:00.000Z" : "2026-10-01T00:00:00.000Z",
	status,
	downloaded_at: "2026-10-10T21:00:00.000Z",
	family: "blg20x",
	artifacts: blg20Demo.artifacts.map(({ path }) => ({ path })),
})

const row = (entry: Entry, state: Row["state"], local: Row["local"] = null): Row => ({
	entry,
	state,
	local,
	folder: local?.folder ?? FOLDER.replace("blg20x/1.0.0", `${entry.family}/${entry.version}`),
})

const fake =
	(rows: Row[]): FirmwareCall =>
	async (req) =>
		req.op === "list" ? { ok: true, rows } : { ok: true }

const noop = () => {}

const Rows = ({ rows, width = 420, family = "blg20x" }: { rows: Row[]; width?: number; family?: string }) => (
	<FirmwareCallContext.Provider value={fake(rows)}>
		<div style={{ width, padding: 12, background: "var(--vscode-sideBar-background)" }}>
			<FirmwareRungs family={family} onAsk={noop} onFlash={noop} onRegister={noop} onRenew={noop} />
		</div>
	</FirmwareCallContext.Provider>
)

const meta: Meta<typeof Rows> = { title: "Rail/Firmware", component: Rows, parameters: { layout: "fullscreen" } }
export default meta
type Story = StoryObj<typeof Rows>

export const SignedOut: Story = { args: { rows: [row({ ...blg20Demo, entitled: false, artifacts: [] }, "register")] } }
export const ReadyToDownload: Story = { args: { rows: [row(blg20Demo, "download")] } }
export const OnDisk: Story = {
	args: { rows: [row(blg20Demo, "flash", { folder: FOLDER, intact: true, receipt: receipt("active") })] },
}
export const TermEnded: Story = {
	args: { rows: [row(blg20Demo, "flash", { folder: FOLDER, intact: true, receipt: receipt("expired") })] },
}
export const FileAltered: Story = {
	args: { rows: [row(blg20Demo, "download", { folder: FOLDER, intact: false, receipt: receipt("active") })] },
}
export const ProductionNotHeld: Story = {
	args: {
		rows: [
			row(blg20Demo, "flash", { folder: FOLDER, intact: true, receipt: receipt("active") }),
			row(blg20Production, "renew"),
		],
	},
}
export const Lew840xDownload: Story = { args: { family: "lew840x", rows: [row(lew840xDemo, "download")] } }
export const NarrowOnDisk: Story = {
	args: { width: 260, rows: [row(blg20Demo, "flash", { folder: FOLDER, intact: true, receipt: receipt("active") })] },
}

/** The whole Hardware page with a BLG20x on USB and the demo pair on disk, at the sidebar's two widths. */
const base = {
	didHydrateState: true,
	version: "0.5.1",
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
		blg20Units: [{ via: "usb", confirmed: true, serialNumber: "9802AF5C69DF1E66", name: "286C", family: "blg20x" }],
		projectSdk: { version: "3.2.1", source: "workspace" },
	},
	espEnvironment: { status: "ready", extensionPresent: false, idfPresent: false, espDevices: [] },
	apiConfiguration: { actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" },
	mode: "act",
	freeTierRemainingTokens: 6_600_000,
	adsumAccount: {
		email: "dev@acme.example",
		name: "Dev",
		emailVerified: true,
		groups: ["blg20-demo-hex", "lew840x-demo-hex"],
		openRequests: [],
	},
	openSessions: [],
	showSettings: false,
	showHistory: false,
	hideSettings: noop,
	hideHistory: noop,
	navigateToSettings: noop,
	navigateToHistory: noop,
}

const Page = ({ width }: { width: number }) => {
	const real = useExtensionState()
	return (
		<ExtensionStateContext.Provider value={{ ...real, ...base } as never}>
			<FirmwareCallContext.Provider
				value={fake([
					row(blg20Demo, "flash", { folder: FOLDER, intact: true, receipt: receipt("active") }),
					row(blg20Production, "renew"),
				])}>
				<div style={{ width, minHeight: 820, background: "var(--vscode-sideBar-background)" }}>
					<RailView initialPage="hardware" />
				</div>
			</FirmwareCallContext.Provider>
		</ExtensionStateContext.Provider>
	)
}

export const HardwarePage420: StoryObj<typeof Page> = { render: () => <Page width={420} /> }
export const HardwarePage260: StoryObj<typeof Page> = { render: () => <Page width={260} /> }
