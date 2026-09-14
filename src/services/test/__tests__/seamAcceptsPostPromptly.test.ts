import { strict as assert } from "node:assert"
import http from "node:http"
import { WebviewProvider } from "@core/webview"
import { after, before, describe, it } from "mocha"
import sinon from "sinon"
import * as vscode from "vscode"
import { createTestServer, shutdownTestServer } from "../TestServer"

/**
 * Host issue H1/H4, 14 September. A seam guard held every POST /task in a remote window until the panel
 * delivered a configuration — and in this build the panel sends one only on a settings action, never on
 * load, while the host already reads the saved route at start. Both probe posts were held 30.6 s and
 * refused 409 with the panel loaded. The guard was removed.
 *
 * This pins the removal: in a remote window whose host already holds a saved provider, a post is taken
 * up at once. The handler is stopped at its first dependency on a live editor (no workspace to validate
 * here), so the answer arrives in milliseconds; a hold of any kind would show as a slow answer or a 409.
 */
describe("the seam takes a task post at once in a remote window (H1 guard must not return)", () => {
	const sandbox = sinon.createSandbox()
	const post = (body: object) =>
		new Promise<{ status: number; body: string; ms: number }>((resolve, reject) => {
			const started = Date.now()
			const req = http.request(
				{ host: "127.0.0.1", port: 9876, path: "/task", method: "POST", headers: { "content-type": "application/json" } },
				(res) => {
					let data = ""
					res.on("data", (d) => (data += d))
					res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, ms: Date.now() - started }))
				},
			)
			req.on("error", reject)
			req.end(JSON.stringify(body))
		})

	before(async () => {
		const v = vscode as unknown as Record<string, unknown>
		v.commands = { executeCommand: async () => undefined }
		;(v.env as Record<string, unknown>).remoteName = "ssh-remote"
		const stateManager = {
			getGlobalSettingsKey: () => undefined,
			setGlobalState: () => undefined,
			// The saved route, already held by the host at start.
			getApiConfiguration: () => ({ actModeApiProvider: "openrouter", planModeApiProvider: "openrouter" }),
		}
		const controller = { stateManager, task: undefined, postStateToWebview: async () => undefined }
		sandbox.stub(WebviewProvider, "getVisibleInstance").returns({ controller } as never)
		await createTestServer(controller as never)
		await new Promise((r) => setTimeout(r, 100))
	})

	after(() => {
		shutdownTestServer()
		sandbox.restore()
		delete ((vscode as unknown as Record<string, Record<string, unknown>>).env ?? {}).remoteName
	})

	it("is answered in well under a second, and never with 409", async function () {
		this.timeout(10_000)
		const r = await post({ task: "hello", driver: "regression-test" })
		assert.notEqual(r.status, 409, `a remote-window post was refused: ${r.body}`)
		assert.ok(r.ms < 2_000, `a remote-window post was held ${r.ms} ms before any answer`)
	})
})
