/**
 * ActionButtons — the developer's half-written message must survive an approval prompt.
 *
 * THE BUG THIS PINS (reported 2026-08-13): typing a message while the agent was running a command,
 * then having an approval request arrive, silently erased what had been typed. The cause was an effect
 * here that cleared inputValue/images/files whenever the message list went
 * `command_output` (ask) → `api_req_started` (say). That transition means the AGENT moved on; it says
 * nothing about whether the DEVELOPER submitted anything. Every real send path clears the box itself
 * (handleSendMessage on `messageSent`, and clearInputState() at the end of each button action), so the
 * effect could only ever fire when nothing had been sent — destroying text with no way to get it back.
 */
import type { ClineMessage } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ActionButtons } from "../ActionButtons"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
		<button {...props}>{children}</button>
	),
}))

const msg = (over: Partial<ClineMessage>): ClineMessage => ({ ts: Date.now(), type: "say", say: "text", ...over }) as ClineMessage

function makeChatState(setInputValue: () => void, setSelectedImages: () => void, setSelectedFiles: () => void) {
	return {
		inputValue: "half-written question about the flash failure",
		selectedImages: ["img1"],
		selectedFiles: ["file1"],
		setInputValue,
		setSelectedImages,
		setSelectedFiles,
		setSendingDisabled: vi.fn(),
	} as never
}

describe("ActionButtons — draft preservation", () => {
	it("does NOT clear the input when an approval arrives after a command", () => {
		const setInputValue = vi.fn()
		const setSelectedImages = vi.fn()
		const setSelectedFiles = vi.fn()

		// The exact sequence that used to wipe the box: the agent asked for command output, then moved
		// on to a new API request, while the developer was still typing.
		const messages: ClineMessage[] = [
			msg({ type: "say", say: "text", text: "task" }),
			msg({ type: "ask", ask: "command_output" }),
			msg({ type: "say", say: "api_req_started" }),
		]

		render(
			<ActionButtons
				chatState={makeChatState(setInputValue, setSelectedImages, setSelectedFiles)}
				messageHandlers={{ handleActionClick: vi.fn() } as never}
				messages={messages}
				mode="act"
				scrollBehavior={
					{
						scrollToBottomSmooth: vi.fn(),
						disableAutoScrollRef: { current: false },
						showScrollToBottom: false,
						virtuosoRef: { current: null },
					} as never
				}
			/>,
		)

		expect(setInputValue).not.toHaveBeenCalled()
		expect(setSelectedImages).not.toHaveBeenCalled()
		expect(setSelectedFiles).not.toHaveBeenCalled()
	})
})
