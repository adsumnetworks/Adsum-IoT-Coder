import { render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { ClineAuthProvider } from "@/context/ClineAuthContext"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"
import ChatTextArea from "./ChatTextArea"

// The model chip's own internals (ModelPickerModal) pull in live-model fetching and settings machinery
// that has nothing to do with the toolbar layout under test; it is mounted closed (isOpen stays false
// the whole time) and its real job — rendering ChatTextArea's own model-chip CHILDREN — survives the
// mock untouched, since those children are passed straight through.
vi.mock("@/components/chat/ModelPickerModal", () => ({
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const noop = () => {}

const renderToolbar = () =>
	render(
		<ExtensionStateContextProvider>
			<ClineAuthProvider>
				<ChatTextArea
					activeQuote={null}
					inputValue=""
					onSelectFilesAndImages={noop}
					onSend={noop}
					placeholderText="Say what you want done."
					ref={createRef()}
					selectedFiles={[]}
					selectedImages={[]}
					sendingDisabled={false}
					setInputValue={noop}
					setSelectedFiles={noop}
					setSelectedImages={noop}
					shouldDisableFilesAndImages={false}
				/>
			</ClineAuthProvider>
		</ExtensionStateContextProvider>,
	)

describe("ChatTextArea composer toolbar", () => {
	it("renders the three left controls (attach, slash, model) and the two right controls (mode, send)", () => {
		renderToolbar()
		expect(screen.getByTestId("attach-button")).toBeInTheDocument()
		expect(screen.getByTestId("slash-button")).toBeInTheDocument()
		expect(screen.getByTestId("model-chip")).toBeInTheDocument()
		expect(screen.getByTestId("mode-chip")).toBeInTheDocument()
		expect(screen.getByTestId("send-button")).toBeInTheDocument()
	})

	it("doesn't duplicate a control that already existed — one attach button, one model chip, one send button", () => {
		renderToolbar()
		expect(screen.getAllByTestId("attach-button")).toHaveLength(1)
		expect(screen.getAllByTestId("model-chip")).toHaveLength(1)
		expect(screen.getAllByTestId("send-button")).toHaveLength(1)
	})

	it("shows Act with the lightning glyph by default, the mode the provider starts in", () => {
		renderToolbar()
		expect(screen.getByTestId("mode-chip")).toHaveTextContent("Act")
	})
})
