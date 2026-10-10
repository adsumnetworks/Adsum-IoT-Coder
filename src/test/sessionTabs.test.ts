import { describe, it } from "mocha"
import "should"
import * as vscode from "vscode"

/**
 * [0.5 sessions first] A session is an editor tab; several can be open; a session that already has a tab is
 * focused, never opened twice; closing a tab leaves the registry without it. Runs inside a real VS Code
 * (vscode-test), against the activated extension.
 */
const EXT_ID = "AdsumNetwork.nrf-ai-debugger"

async function ext() {
	const e = vscode.extensions.getExtension(EXT_ID)
	if (!e) {
		throw new Error(`extension ${EXT_ID} not found`)
	}
	if (!e.isActive) {
		await e.activate()
	}
	return e
}

const sessionTabs = () =>
	vscode.window.tabGroups.all
		.flatMap((g) => g.tabs)
		.filter(
			(t) =>
				t.input instanceof vscode.TabInputWebview &&
				(t.input as vscode.TabInputWebview).viewType.includes("adsum-iot-coder.session"),
		)

describe("session tabs", () => {
	it("+ opens a session tab in the editor area", async () => {
		await ext()
		await vscode.commands.executeCommand("adsum.session.new")
		await new Promise((r) => setTimeout(r, 800))
		sessionTabs().length.should.be.greaterThanOrEqual(1)
		sessionTabs()[0].label.should.equal("New session")
	})

	it("a second + opens a second tab; the title bar's + does the same", async () => {
		const before = sessionTabs().length
		await vscode.commands.executeCommand("adsum.session.new")
		await new Promise((r) => setTimeout(r, 500))
		sessionTabs().length.should.equal(before + 1)
		await vscode.commands.executeCommand("adsum-iot-coder.plusButtonClicked")
		await new Promise((r) => setTimeout(r, 500))
		sessionTabs().length.should.equal(before + 2)
	})

	it("closing a tab removes it from the registry; the sidebar keeps working", async () => {
		const tabs = sessionTabs()
		const n = tabs.length
		await vscode.window.tabGroups.close(tabs[0])
		await new Promise((r) => setTimeout(r, 500))
		sessionTabs().length.should.equal(n - 1)
		// The sidebar command still resolves: the registry did not lose the sidebar instance.
		await vscode.commands.executeCommand("adsum-iot-coder.focusChatInput", true)
	})

	it("focusChatInput lands in a session tab, opening one when none is active", async () => {
		for (const t of sessionTabs()) {
			await vscode.window.tabGroups.close(t)
		}
		await new Promise((r) => setTimeout(r, 300))
		await vscode.commands.executeCommand("adsum-iot-coder.focusChatInput", false)
		await new Promise((r) => setTimeout(r, 800))
		sessionTabs().length.should.equal(1)
	})
})
