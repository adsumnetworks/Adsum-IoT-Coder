import { describe, it } from "mocha"
import "should"
import { StreamResponseHandler } from "../StreamResponseHandler"

/**
 * Regression for the "User closed text editor" / "path cutting off" write_to_file failure.
 *
 * Native tool-call arguments stream as partial JSON. A still-streaming file path must NOT be
 * surfaced truncated — opening the diff editor on a half-streamed path points it at the wrong
 * file and the write fails. Only the long streaming fields (content / diff) may be partial.
 */
describe("StreamResponseHandler — partial tool-arg field extraction", () => {
	function partialParamsFor(input: string): Record<string, any> {
		const toolUseHandler = new StreamResponseHandler().getHandlers().toolUseHandler
		// Incomplete JSON (no closing brace) → forces the partial-field extraction path.
		toolUseHandler.processToolUseDelta({ id: "t1", type: "tool_use", name: "write_to_file", input })
		const partials = toolUseHandler.getPartialToolUsesAsContent()
		partials.should.have.length(1)
		return partials[0].params as Record<string, any>
	}

	it("withholds a still-streaming absolutePath (no closing quote yet)", () => {
		// content arrived first and fully; absolutePath is the trailing, still-streaming field.
		const params = partialParamsFor('{"content": "hello world", "absolutePath": "/home/omar/Desktop/led-play')
		params.should.have.property("content", "hello world")
		// The truncated path must NOT be surfaced — this is the bug that opened the editor on "/led-play".
		params.should.not.have.property("absolutePath")
	})

	it("surfaces absolutePath once its closing quote has streamed", () => {
		const params = partialParamsFor('{"content": "hello world", "absolutePath": "/home/omar/Desktop/led-play/main/main.c"')
		params.should.have.property("absolutePath", "/home/omar/Desktop/led-play/main/main.c")
	})

	it("still streams partial content (the diff-view animation is preserved)", () => {
		const params = partialParamsFor('{"absolutePath": "/abs/path/main.c", "content": "partial cont')
		params.should.have.property("absolutePath", "/abs/path/main.c")
		params.should.have.property("content", "partial cont")
	})

	it("withholds a still-streaming path param too (replace_in_file uses path)", () => {
		const params = partialParamsFor('{"diff": "<<<<<<< SEARCH", "path": "/abs/proj/sd')
		params.should.have.property("diff")
		params.should.not.have.property("path")
	})
})
