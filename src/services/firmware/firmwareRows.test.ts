import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { firmwareRowState } from "./firmwareRows"

const base = { entitled: false, group: "blg20-demo-hex", signedIn: true, local: null }

describe("firmware row state: one action per state", () => {
	it("an intact folder flashes, whatever the account now holds (an ended term still flashes)", () => {
		assert.equal(firmwareRowState({ ...base, local: { intact: true } }), "flash")
		assert.equal(firmwareRowState({ ...base, signedIn: false, local: { intact: true } }), "flash")
	})
	it("a held version downloads; a broken folder is downloaded again by someone who may", () => {
		assert.equal(firmwareRowState({ ...base, entitled: true }), "download")
		assert.equal(firmwareRowState({ ...base, entitled: true, local: { intact: false } }), "download")
	})
	it("a broken folder is never a Download button for someone who may not download it", () => {
		assert.equal(firmwareRowState({ ...base, local: { intact: false } }), "ask")
		assert.equal(firmwareRowState({ ...base, group: "blg20-prod-hex", local: { intact: false } }), "renew")
	})
	it("no account: register, the free way in, never Ask (asking needs an account)", () => {
		assert.equal(firmwareRowState({ ...base, signedIn: false }), "register")
		assert.equal(firmwareRowState({ ...base, signedIn: false, group: "blg20-prod-hex" }), "register")
	})
	it("a production or source rung not held renews on the web; any other rung asks", () => {
		assert.equal(firmwareRowState({ ...base, group: "blg20-prod-hex" }), "renew")
		assert.equal(firmwareRowState({ ...base, group: "lew840x-ble-src" }), "renew")
		assert.equal(firmwareRowState({ ...base, group: "lew840x-demo-hex" }), "ask")
		assert.equal(firmwareRowState({ ...base, group: null }), "ask")
	})
})
