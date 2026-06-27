import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Meta, StoryObj } from "@storybook/react"
import CraProgressRail from "./CraProgressRail"

const say = (text: string): ClineMessage => ({ ts: 1, type: "say", say: "text", text })
const done = (): ClineMessage => ({ ts: 2, type: "say", say: "completion_result", text: "done" })

const meta: Meta<typeof CraProgressRail> = {
	title: "chat/CraProgressRail",
	component: CraProgressRail,
	decorators: [(Story) => <div style={{ width: 360, border: "1px solid var(--vscode-editorGroup-border)" }}>{Story()}</div>],
}
export default meta
type Story = StoryObj<typeof CraProgressRail>

/** Step 2 active — the "is it stuck?" moment: a live CVE lookup, announced. */
export const Scanning: Story = {
	args: { messages: [say("### Step 1/5 · Inventory"), say("### Step 2/5 · Scan for known vulnerabilities")] },
}

/** Step 4 active — triage. */
export const Triaging: Story = {
	args: { messages: ["### Step 1/5", "### Step 2/5", "### Step 3/5", "### Step 4/5 · Triage"].map(say) },
}

/** Complete — all five done (counts/verdict-free caption). */
export const Complete: Story = { args: { messages: [say("### Step 5/5 · One concrete next step"), done()] } }

/** Not a CRA run — the rail self-hides (renders nothing). */
export const Hidden: Story = { args: { messages: [say("just a normal chat message")] } }
