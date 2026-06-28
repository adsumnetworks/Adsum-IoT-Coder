import type { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import * as vscode from "vscode"
import type { ScanLoopResult } from "@/services/cra/scanLoop"
import { ClineDefaultTool } from "@/shared/tools"
import type { CveScanHandlerDeps } from "../TriggerCveScanHandler"
import { TriggerCveScanHandler } from "../TriggerCveScanHandler"

// Unit tests for the handler. The deterministic scan logic is covered exhaustively in src/services/cra/*.node-test;
// here we inject the scan/fs/clock seams and assert the handler's orchestration: validation, write-guard, the
// happy path (artifacts written + report returned), and the two failure paths (scan / write).

const fakeContext = { extensionUri: { fsPath: "/ext/install" } } as unknown as vscode.ExtensionContext

const mkBlock = (params: Record<string, string>): ToolUse => ({
	type: "tool_use",
	name: ClineDefaultTool.CVE_SCAN,
	params,
	partial: false,
})

const fakeResult: ScanLoopResult = {
	report: "## CVE scan — OSV, as of 2026-06-25\n\nCoverage: 1 queryable.",
	json: '{"schema":"adsum.cve-scan/1"}',
	findings: [],
	coverage: { total: 1, withPurl: 1, withCpe: 0, unidentified: 0, queryable: 1, byDropReason: {} },
	skipped: [],
	queriedCount: 1,
	normalized: {
		components: [],
		coverage: { total: 1, withPurl: 1, withCpe: 0, unidentified: 0, queryable: 1, byDropReason: {} },
	},
	enrichment: new Map(),
	sources: { osv: 0, nvd: 0, euvdProduct: 0, euvdConfirmed: 0 },
}

describe("TriggerCveScanHandler", () => {
	let sandbox: sinon.SinonSandbox
	let say: sinon.SinonStub
	let sayAndCreateMissingParamError: sinon.SinonStub

	const mkConfig = (cwd: string): any => ({
		cwd,
		taskState: { consecutiveMistakeCount: 0 },
		callbacks: { say, sayAndCreateMissingParamError },
	})

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		say = sandbox.stub().resolves()
		sayAndCreateMissingParamError = sandbox.stub().resolves("missing-param")
	})
	afterEach(() => sandbox.restore())

	// Build a handler with stubbed seams. Returns the handler + the stubs for assertions.
	const mkHandler = (over: Partial<CveScanHandlerDeps> = {}) => {
		const scan = sandbox.stub().resolves(fakeResult)
		const mkdir = sandbox.stub()
		const writeFile = sandbox.stub()
		const now = sandbox.stub().returns("2026-06-25")
		const handler = new TriggerCveScanHandler(fakeContext, { scan, mkdir, writeFile, now, ...over })
		return { handler, scan, mkdir, writeFile, now }
	}

	it("has the CVE_SCAN tool name", () => {
		expect(mkHandler().handler.name).to.equal(ClineDefaultTool.CVE_SCAN)
	})

	it("getDescription reflects the SBOM path", () => {
		expect(mkHandler().handler.getDescription(mkBlock({ sbom: "compliance/sbom/app.spdx" }))).to.contain("app.spdx")
	})

	it("missing sbom → mistake count incremented + missing-param error, no scan", async () => {
		const { handler, scan } = mkHandler()
		const config = mkConfig("/proj")
		const res = await handler.execute(config, mkBlock({}))
		expect(config.taskState.consecutiveMistakeCount).to.equal(1)
		expect(sayAndCreateMissingParamError.calledOnceWith(ClineDefaultTool.CVE_SCAN, "sbom")).to.equal(true)
		expect(res).to.equal("missing-param")
		expect(scan.called).to.equal(false)
	})

	it("happy path: scans, writes md+json with the dated names, returns report + pointer", async () => {
		const { handler, scan, mkdir, writeFile } = mkHandler()
		const res = await handler.execute(mkConfig("/proj"), mkBlock({ sbom: "compliance/sbom/app.spdx", build: "build" }))
		// scan called with cwd-resolved absolute paths
		expect(scan.calledOnce).to.equal(true)
		expect(scan.firstCall.args[0]).to.deep.equal({
			sbomPath: "/proj/compliance/sbom/app.spdx",
			buildDir: "/proj/build",
			asOf: "2026-06-25",
		})
		expect(mkdir.calledOnceWith("/proj/compliance")).to.equal(true)
		const written = writeFile.getCalls().map((c) => c.args[0])
		expect(written).to.deep.equal(["/proj/compliance/cve-scan-2026-06-25.md", "/proj/compliance/cve-scan-2026-06-25.json"])
		expect(writeFile.firstCall.args[1]).to.equal(fakeResult.report)
		expect(writeFile.secondCall.args[1]).to.equal(fakeResult.json)
		expect(String(res)).to.contain("CVE scan — OSV")
		expect(String(res)).to.contain("cve-scan-2026-06-25.md")
		expect(say.calledWith("tool")).to.equal(true)
	})

	it("writes artifacts next to the SBOM's compliance/ dir, NOT the cwd (no Desktop littering)", async () => {
		// Regression for a live run: cwd was the Desktop but the SBOM lived in another project; the scan wrote
		// compliance/ into the Desktop. Output must derive from the SBOM path, not cwd.
		const { handler, mkdir, writeFile } = mkHandler()
		await handler.execute(mkConfig("/Users/me/Desktop"), mkBlock({ sbom: "/Users/me/proj/compliance/sbom/app.spdx" }))
		expect(mkdir.calledOnceWith("/Users/me/proj/compliance")).to.equal(true)
		const written = writeFile.getCalls().map((c) => c.args[0])
		expect(written).to.deep.equal([
			"/Users/me/proj/compliance/cve-scan-2026-06-25.md",
			"/Users/me/proj/compliance/cve-scan-2026-06-25.json",
		])
		// never the cwd
		expect(written.some((w) => w.includes("/Desktop/"))).to.equal(false)
	})

	it("no build param → scan called with buildDir undefined", async () => {
		const { handler, scan } = mkHandler()
		await handler.execute(mkConfig("/proj"), mkBlock({ sbom: "app.spdx" }))
		expect(scan.firstCall.args[0].buildDir).to.equal(undefined)
	})

	it("scan failure → tool error, NO artifacts written (never a false 'no vulnerabilities')", async () => {
		const { handler, writeFile } = mkHandler({ scan: sandbox.stub().rejects(new Error("OSV query failed: HTTP 503")) })
		const res = await handler.execute(mkConfig("/proj"), mkBlock({ sbom: "app.spdx" }))
		expect(String(res)).to.match(/could not run/i)
		expect(String(res)).to.contain("503")
		expect(writeFile.called).to.equal(false)
		expect(say.calledWith("error")).to.equal(true)
	})

	it("write failure → tool error", async () => {
		const { handler } = mkHandler({
			writeFile: sandbox.stub().throws(new Error("EACCES")),
		})
		const res = await handler.execute(mkConfig("/proj"), mkBlock({ sbom: "app.spdx" }))
		expect(String(res)).to.match(/could not be written/i)
	})

	it("write-guard: refuses to write inside the extension install", async () => {
		const { handler, scan } = mkHandler()
		const res = await handler.execute(mkConfig("/ext/install/some/project"), mkBlock({ sbom: "app.spdx" }))
		expect(String(res)).to.match(/Refusing to write/i)
		expect(scan.called).to.equal(false) // guarded before any scan
	})

	it("write-guard: refuses to write inside a bundled demo-scenarios sample", async () => {
		const { handler } = mkHandler()
		const res = await handler.execute(mkConfig("/x/demo-scenarios/nus-uart"), mkBlock({ sbom: "app.spdx" }))
		expect(String(res)).to.match(/demo-scenarios/i)
	})

	it("absolute sbom/build paths are passed through unchanged", async () => {
		const { handler, scan } = mkHandler()
		await handler.execute(mkConfig("/proj"), mkBlock({ sbom: "/abs/app.spdx", build: "/abs/build" }))
		expect(scan.firstCall.args[0].sbomPath).to.equal("/abs/app.spdx")
		expect(scan.firstCall.args[0].buildDir).to.equal("/abs/build")
	})
})
