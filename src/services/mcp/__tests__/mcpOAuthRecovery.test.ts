import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { expect } from "chai"
import { isServerRejectedAuth } from "../McpHub"

/**
 * A Nordic MCP user on 0.2.1 sat in an `initialize` retry loop forever, five seconds apart, on a token the
 * server had revoked: "invalid, expired, or no longer recognized by the server".
 *
 * The dead end was structural. `tokens()` judges validity against the LOCAL clock only, so a revoked but
 * unexpired token still looks good; the SDK's `auth()` therefore returns AUTHORIZED without ever calling
 * the token endpoint, the transport retries with the same dead token, and no OAuth error is raised — so
 * the SDK's own `invalidateCredentials` hook is never reached either. Nothing in the loop could break it.
 *
 * These tests pin the discriminator that lets us break it: a server REJECTING credentials we hold is not
 * the same event as a server ASKING for credentials we lack.
 */
describe("MCP OAuth recovery — telling a rejected token from a missing one", () => {
	it("treats UnauthorizedError as 'needs auth', NOT as a rejected token", () => {
		// This one already had a working path: it raises the Authenticate button. Re-clearing credentials
		// here would throw away a good pending authorization flow.
		expect(isServerRejectedAuth(new UnauthorizedError())).to.equal(false)
	})

	it("recognises the SDK's post-auth 401 — the exact shape of the reported loop", () => {
		const err = Object.assign(new Error("Server returned 401 after successful authentication"), { code: 401 })
		expect(isServerRejectedAuth(err)).to.equal(true)
	})

	it("recognises a bare 401 by code, whatever the message says", () => {
		expect(isServerRejectedAuth(Object.assign(new Error("Error POSTing to endpoint"), { code: 401 }))).to.equal(true)
	})

	it("recognises the server's own wording, verbatim from the field report", () => {
		const body =
			'Error 401 status sending message to https://aidev.nordicsemi.com/mcp: {"error":"invalid_token",' +
			'"error_description":"Authentication failed. The provided bearer token is invalid, expired, or no ' +
			'longer recognized by the server."}'
		expect(isServerRejectedAuth(new Error(body))).to.equal(true)
	})

	it("does NOT fire on unrelated failures — a cleared token is not a free action", () => {
		// Over-eager clearing would log people out on a flaky network or a server-side crash.
		for (const msg of ["ECONNREFUSED 127.0.0.1:3000", "Server returned 500", "socket hang up", "404 Not Found"]) {
			expect(isServerRejectedAuth(new Error(msg)), msg).to.equal(false)
		}
		expect(isServerRejectedAuth(undefined)).to.equal(false)
		expect(isServerRejectedAuth(null)).to.equal(false)
	})

	it("does not mistake a 401 inside a longer number for a status code", () => {
		expect(isServerRejectedAuth(new Error("request id 9401123 failed"))).to.equal(false)
	})
})
