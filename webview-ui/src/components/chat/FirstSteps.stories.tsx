import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import FirstSteps from "./FirstSteps"

/**
 * [0.5 sessions first] The five-row ladder under an empty session tab's "Say what you want done" line.
 * See the component doc comment for the done-state rule (facts, never a click) and the dismiss contract.
 */
const meta: Meta<typeof FirstSteps> = {
	title: "Session/FirstSteps",
	component: FirstSteps,
	args: { onOpenProject: fn(), onPrefillBuild: fn(), onPrefillGateway: fn(), onRegister: fn(), onRunSample: fn() },
}

export default meta
type Story = StoryObj<typeof FirstSteps>

export const ColdStart: Story = {
	args: { state: {} },
}

export const SampleDone: Story = {
	args: { state: { taskHistory: [{ task: "Demo: BLE NUS\n\n[ADSUM_DEMO:nus-uart]" }] } },
}

export const ProjectAndBuildDone: Story = {
	args: {
		state: {
			taskHistory: [{ task: "[ADSUM_DEMO:nus-uart]" }, { task: "Build and flash the connected board" }],
			openFolderPaths: ["/Users/dev/gateway-fw"],
		},
	},
}

export const AllDone: Story = {
	args: {
		state: {
			taskHistory: [{ task: "[ADSUM_DEMO:nus-uart]" }, { task: "flash it" }, { task: "blg20x first run" }],
			openFolderPaths: ["/Users/dev/gateway-fw"],
			adsumAccount: { email: "dev@example.com", emailVerified: true, groups: [], name: "Dev", openRequests: [] },
		},
	},
	parameters: {
		docs: { description: { story: "No row is ever ticked by magic — this fixture simply supplies every fact at once." } },
	},
}
