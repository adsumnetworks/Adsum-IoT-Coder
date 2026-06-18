import { expect } from "chai"
import { describe, it } from "mocha"
import { isUnderExtensionOrSample } from "../WriteToFileToolHandler"

/**
 * The write-guard stops the agent from writing into the Adsum extension install (read-only on a
 * published build) or any copy of the bundled samples (`demo-scenarios/…`, ours not the user's) —
 * the failure mode the CRA bundled-sample run hit (it wrote a compliance/ + modified prj.conf inside
 * the sample). Pure path logic, so it's testable cross-platform without a host.
 */
describe("isUnderExtensionOrSample — write-guard for extension/bundled-sample paths", () => {
	const ext = "/Users/x/.vscode/extensions/adsumnetwork.nrf-ai-debugger-0.1.7"

	it("blocks writes under the extension install dir (incl. the root itself)", () => {
		expect(isUnderExtensionOrSample(`${ext}/iot-knowledge/foo.md`, ext)).to.equal(true)
		expect(isUnderExtensionOrSample(`${ext}/demo-scenarios/nus-uart/central_uart/compliance/x.md`, ext)).to.equal(true)
		expect(isUnderExtensionOrSample(ext, ext)).to.equal(true)
	})

	it("blocks any bundled-sample copy even OUTSIDE the install (dev/source checkout)", () => {
		expect(isUnderExtensionOrSample("/Users/x/Desktop/repo/demo-scenarios/nus-uart/central_uart/prj.conf")).to.equal(true)
	})

	it("allows the user's own project and OS temp dirs", () => {
		expect(isUnderExtensionOrSample("/Users/x/projects/my-fw/compliance/CRA_READINESS.md", ext)).to.equal(false)
		expect(isUnderExtensionOrSample("/tmp/cra-run/compliance/x.md", ext)).to.equal(false)
	})

	it("only matches demo-scenarios as a full path segment (no false positive on a substring)", () => {
		expect(isUnderExtensionOrSample("/Users/x/my-demo-scenarios-app/src/main.c")).to.equal(false)
	})

	it("handles a trailing slash on the extension root", () => {
		expect(isUnderExtensionOrSample(`${ext}/x`, `${ext}/`)).to.equal(true)
	})

	it("handles Windows-style separators", () => {
		const win = "C:\\Users\\x\\.vscode\\extensions\\adsum-0.1.7"
		expect(
			isUnderExtensionOrSample("C:\\Users\\x\\.vscode\\extensions\\adsum-0.1.7\\demo-scenarios\\nus-uart\\f", win),
		).to.equal(true)
		expect(isUnderExtensionOrSample("C:\\Users\\x\\proj\\compliance\\f", win)).to.equal(false)
	})
})
