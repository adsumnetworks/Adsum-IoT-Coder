import type { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import * as vscode from "vscode"
import { ClineDefaultTool } from "@/shared/tools"
import { TriggerCveScanHandler } from "../TriggerCveScanHandler"

// Mocha unit test (run via the host test suite / CI). It covers the param-validation + guard paths that don't
// need a live task loop or network; the deterministic scan logic itself is covered in src/services/cra/*.node-test.

const fakeContext = { extensionUri: { fsPath: "/ext/install" } } as unknown as vscode.ExtensionContext

const mkBlock = (params: Record<string, string>): ToolUse => ({
	type: "tool_use",
	name: ClineDefaultTool.CVE_SCAN,
	params,
	partial: false,
})

describe("TriggerCveScanHandler", () => {
	let sandbox: sinon.SinonSandbox
	let handler: TriggerCveScanHandler

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		handler = new TriggerCveScanHandler(fakeContext)
	})
	afterEach(() => sandbox.restore())

	it("has the CVE_SCAN tool name", () => {
		expect(handler.name).to.equal(ClineDefaultTool.CVE_SCAN)
	})

	it("getDescription reflects the SBOM path", () => {
		expect(handler.getDescription(mkBlock({ sbom: "compliance/sbom/app.spdx" }))).to.contain("app.spdx")
	})

	it("missing sbom param → mistake count incremented + missing-param error", async () => {
		const sayAndCreateMissingParamError = sandbox.stub().resolves("missing-param")
		const config: any = {
			cwd: "/proj",
			taskState: { consecutiveMistakeCount: 0 },
			callbacks: { sayAndCreateMissingParamError, say: sandbox.stub().resolves() },
		}
		const res = await handler.execute(config, mkBlock({}))
		expect(config.taskState.consecutiveMistakeCount).to.equal(1)
		expect(sayAndCreateMissingParamError.calledOnceWith(ClineDefaultTool.CVE_SCAN, "sbom")).to.equal(true)
		expect(res).to.equal("missing-param")
	})

	it("refuses to write a scan inside the extension install (write-guard)", async () => {
		const say = sandbox.stub().resolves()
		const config: any = {
			cwd: "/ext/install/some/project", // under the extension root → guarded
			taskState: { consecutiveMistakeCount: 0 },
			callbacks: { say },
		}
		const res = await handler.execute(config, mkBlock({ sbom: "compliance/sbom/app.spdx" }))
		expect(say.calledWith("error")).to.equal(true)
		expect(String(res)).to.match(/Refusing to write/i)
	})

	it("refuses to write a scan inside a bundled demo-scenarios sample", async () => {
		const say = sandbox.stub().resolves()
		const config: any = {
			cwd: "/some/where/demo-scenarios/nus-uart",
			taskState: { consecutiveMistakeCount: 0 },
			callbacks: { say },
		}
		const res = await handler.execute(config, mkBlock({ sbom: "app.spdx" }))
		expect(String(res)).to.match(/demo-scenarios/i)
	})
})
