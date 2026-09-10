/**
 * The account bearer, held on its own so that reading it costs nothing but the token.
 *
 * WHY THIS IS A SEPARATE FILE. `RegistryClient` needs one string: the bearer to send, if there is
 * one. Importing it from `AccountState` dragged in `StateManager` and, through it, `vscode` — so
 * every plain-node test that touched the resolver died on `Cannot find module 'vscode'`. From
 * 2026-09-06 that silently broke `npm run test:kbits`, which the pre-commit hook runs, and 66
 * commits went in past a hook that could no longer pass.
 *
 * Same shape as `editorWindow.ts` beside it: the value lives here, the host writes it, and core code
 * reads it without knowing where it came from. `AccountState` remains the only writer — it owns the
 * keychain, the sign-in and the lifecycle; this module owns nothing but the current value.
 */

let token: string | undefined

/** The bearer for RegistryClient. `undefined` ⇒ send no Authorization header at all. */
export function getSessionToken(): string | undefined {
	return token
}

/** AccountState only: the token changed — signed in, signed out, or restored at activation. */
export function setSessionToken(next: string | undefined): void {
	token = next || undefined
}
