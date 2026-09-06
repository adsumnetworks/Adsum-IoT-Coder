/**
 * The EXTENSION's own modules, against a LIVE backend. No editor, and no double of our code —
 * `AccountState` here is the one the VSIX ships, and the only thing standing in for VS Code is the
 * storage it was already written to survive without.
 *
 * `account.node-test.ts` proves the same module against a mocked `fetch`. This proves it against the
 * real routes, which is where a contract drifts: a renamed field or a changed status code passes a
 * mock and fails a person.
 *
 * Needs the E2E backend on :7788 and the adsum_e2e database. CLINE_ENVIRONMENT must be set in the
 * ENVIRONMENT, not in this file: ClineEnv reads it when the module is imported, which happens before
 * any line of main() runs.
 *   npm run test:host-e2e
 */
import { execSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { accountHasGroup } from "@shared/adsumAccount"
import * as account from "./AccountState"

// localhost and 127.0.0.1 are the same host and NOT the same string; the config says localhost.
const B = "http://localhost:7788"
const results: [string, boolean, string][] = []
const check = (name: string, pass: boolean, detail = "") => {
	results.push([name, pass, detail])
	console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`)
}
const sql = (q: string) =>
	execSync(`psql -d adsum_e2e -tAc ${JSON.stringify(q)}`)
		.toString()
		.trim()

async function main() {
	const email = `host+${Date.now().toString(36)}@example.com`
	const uid = randomUUID()
	sql(`insert into auth_user (id,name,email,"emailVerified") values ('${uid}','Host','${email}',true)`)

	console.log("\nTHE SIGN-IN URL THE EXTENSION BUILDS")
	const u = new URL(account.buildSignInUrl("github", "cursor"))
	check("points at the configured backend", u.origin === B, u.origin)
	check("names the provider", u.searchParams.get("provider") === "github")
	check("carries the editor scheme, so the browser's button names the right one", u.searchParams.get("redirect") === "cursor")
	const state = u.searchParams.get("state") ?? ""
	check("carries an unguessable nonce", state.length >= 24, `${state.length} chars`)

	console.log("\nTHE CALLBACK THE URI HANDLER RECEIVES")
	// Mint a one-time code the way /auth/done does, bound to the nonce this module just generated.
	// sha256 in Node because pgcrypto is not installed here, and the backend hashes it the same way.
	const codeHash = createHash("sha256").update("E2ECODE").digest("hex")
	sql(
		`insert into auth_codes (code_hash,user_id,state,expires_at) values ('${codeHash}','${uid}','${state}',now()+interval '60 seconds')`,
	)
	check("a callback this window did not start is refused", (await account.completeSignIn("E2ECODE", "not-the-nonce")) === false)
	check("the real callback signs in", (await account.completeSignIn("E2ECODE", state)) === true)
	check("the profile is held", account.getAccount()?.email === email, account.getAccount()?.email ?? "none")
	check("a bearer is held", (account.getSessionToken() ?? "").startsWith("adu_"))
	const bearer = account.getSessionToken() ?? ""

	console.log("\nWHAT THE PANEL RENDERS FROM")
	check("no grant yet, so cellular is locked", account.hasGroup("cellular-advanced") === false)
	check("an ungrouped card stays open to everyone", account.hasGroup(undefined) === true)

	console.log("\nA GRANT MADE IN THE ADMIN PAGE REACHES THE EDITOR")
	for (const g of ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"]) {
		sql(
			`insert into account_entitlements (user_id,entitlement,granted_by) values ('${uid}','${g}','ismail') on conflict do nothing`,
		)
	}
	await account.refresh(true)
	check("the next refresh picks it up — no restart", account.hasGroup("cellular-advanced") === true)
	check("and the second group", account.hasGroup("edge-ai-advanced") === true)
	check("but not one nobody granted", account.hasGroup("lew840x-9160-src") === false)
	check("the helper the webview uses agrees", accountHasGroup(account.getAccount() as never, "lew840x-demo-hex") === true)

	console.log("\nREVOCATION AND SIGN-OUT")
	sql(`delete from account_entitlements where user_id='${uid}' and entitlement='cellular-advanced'`)
	await account.refresh(true)
	check("a revoked group locks again on the next refresh", account.hasGroup("cellular-advanced") === false)
	await account.signOut()
	check("sign-out clears the profile", account.getAccount() === null)
	check("sign-out clears the bearer", account.getSessionToken() === undefined)
	const dead = await fetch(`${B}/v1/me`, { headers: { authorization: `Bearer ${bearer}` } })
	check("and the server-side session is gone too", dead.status === 401, `→ ${dead.status}`)

	sql(`delete from auth_user where id='${uid}'`)
	const failed = results.filter(([, p]) => !p)
	console.log(`\n${results.length - failed.length}/${results.length} passed`)
	failed.forEach(([n, , d]) => console.log(`  ✗ ${n} ${d}`))
	process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
