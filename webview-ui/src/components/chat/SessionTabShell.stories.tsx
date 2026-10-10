import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import ChatTextArea from "./ChatTextArea"
import EmptySession from "./EmptySession"
import PreferSidebarHint from "./PreferSidebarHint"
import SessionComposerFoot from "./SessionComposerFoot"
import SessionWordmark from "./SessionWordmark"

/**
 * [0.5] The empty session tab as one page: the pieces ChatView mounts, in the same centred column, so the
 * whole can be looked at before a build. The column rule lives in index.css.
 */
const Shell = () => (
	<div
		style={{
			// Pinned to the viewport so the decorator's own panel cannot offset the column.
			position: "fixed",
			inset: 0,
			background: "var(--vscode-editor-background)",
			display: "flex",
			flexDirection: "column",
		}}>
		<div className="session-column grow">
			<SessionWordmark view="session" />
			<EmptySession onPrefill={() => {}} onStartTask={() => {}} />
		</div>
		<div className="session-composer">
			<PreferSidebarHint view="session" />
			<ChatTextArea
				activeQuote={null}
				inputValue=""
				onSelectFilesAndImages={fn()}
				onSend={fn()}
				placeholderText="Say what you want done. ⌘⏎ sends, / for commands, @ to mention"
				selectedFiles={[]}
				selectedImages={[]}
				sendingDisabled={false}
				setInputValue={fn()}
				setSelectedFiles={fn()}
				setSelectedImages={fn()}
				shouldDisableFilesAndImages={false}
			/>
			<SessionComposerFoot folderName="gateway-fw" hasTask={false} onOpenPalette={() => {}} view="session" />
		</div>
	</div>
)

const meta: Meta<typeof Shell> = {
	title: "Session/TabShell",
	component: Shell,
	parameters: { layout: "fullscreen" },
	decorators: [
		createStorybookDecorator({
			apiConfiguration: { actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" },
			mode: "act",
			taskHistory: [],
			openFolderPaths: ["/Users/dev/gateway-fw"],
			workspaceRoots: ["/Users/dev/gateway-fw"],
		} as any),
	],
}
export default meta
type Story = StoryObj<typeof Shell>
export const EmptyTab: Story = {}
