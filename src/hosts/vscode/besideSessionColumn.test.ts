import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { columnBesideSession, SESSION_PANEL_TYPE } from "./besideSessionColumn"

/**
 * Where a file or a change view opens while a session tab is in front.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/hosts/vscode/besideSessionColumn.test.ts
 */
const session = `mainThreadWebview-${SESSION_PANEL_TYPE}`

describe("columnBesideSession", () => {
	test("the session is the only group: a new group beside it", () => {
		assert.equal(columnBesideSession([{ active: true, viewColumn: 1, frontWebviewType: session }]), "beside")
	})
	test("code is open in another group: the document goes there, not over the conversation", () => {
		assert.equal(
			columnBesideSession([
				{ active: false, viewColumn: 1 },
				{ active: true, viewColumn: 2, frontWebviewType: session },
			]),
			1,
		)
	})
	test("two sessions side by side: never on top of the other session", () => {
		assert.equal(
			columnBesideSession([
				{ active: true, viewColumn: 1, frontWebviewType: session },
				{ active: false, viewColumn: 2, frontWebviewType: session },
			]),
			"beside",
		)
	})
	test("the developer is in a file, or in another webview: the editor decides as before", () => {
		assert.equal(columnBesideSession([{ active: true, viewColumn: 1 }]), undefined)
		assert.equal(columnBesideSession([{ active: true, viewColumn: 1, frontWebviewType: "markdown.preview" }]), undefined)
		assert.equal(columnBesideSession([]), undefined)
	})
})
