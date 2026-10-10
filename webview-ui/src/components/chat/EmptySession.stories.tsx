import type { Meta, StoryObj } from "@storybook/react-vite"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import EmptySession from "./EmptySession"

/** [0.5] The empty session tab: three rows under entryMode(), the placeholder that teaches. */
const Wrapped = ({ state }: { state: Record<string, unknown> }) => {
	const real = useExtensionState()
	return (
		<ExtensionStateContext.Provider
			value={
				{
					...real,
					didHydrateState: true,
					taskHistory: [],
					openFolderPaths: ["/Users/dev/gateway-fw"],
					workspaceRoots: ["/Users/dev/gateway-fw"],
					workspaceClassification: "nrf",
					nrfEnvironment: { status: "ready", extensionPresent: true, nrfutilPresent: true, boards: [] },
					apiConfiguration: { actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" },
					...state,
				} as never
			}>
			<div style={{ width: 900, minHeight: 600, background: "var(--vscode-editor-background)" }}>
				<EmptySession onPrefill={() => {}} onStartTask={() => {}} />
			</div>
		</ExtensionStateContext.Provider>
	)
}
const meta: Meta<typeof Wrapped> = { title: "Session/EmptySession", component: Wrapped, parameters: { layout: "fullscreen" } }
export default meta
type Story = StoryObj<typeof Wrapped>
export const FirstRun: Story = { args: { state: { openFolderPaths: [], workspaceRoots: [], workspaceClassification: "none" } } }
export const ProjectOpen: Story = { args: { state: {} } }
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
		},
	},
}
