import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isRequestOnlyGroup, REGISTERED_TIER_GROUPS, requestFamilyFor } from "../welcomeIntents"

/**
 * The way in a locked thing names: "Register", or "Ask for more details".
 *
 * [14 Sep 2026] The answer came from a hand-kept list of six BLG20x groups. It missed the LEW840x source
 * and production groups and the BLG20x demo pair, so a registered developer who met one of those in a task
 * was sent to register — a door that could never open it. It is now derived from the registered tier, and
 * the tier here is compared with the server's whenever the backend checkout sits beside this one.
 */
const EVERY_GROUP = [
	"cellular-advanced",
	"edge-ai-advanced",
	"lew840x-demo-hex",
	"lew840x-prod-hex",
	"lew840x-ble-src",
	"lew840x-esp-src",
	"lew840x-9160-src",
	"blg20-demo-hex",
	"blg20-prod-hex",
	"blg20-ble-src",
	"blg20-esp-src",
	"blg20-9151-src",
	"blg20-early-access",
	"blg20-adv-ble",
	"blg20-adv-full",
]

describe("the way in", () => {
	it("registering opens the tier groups, so they alone say Register", () => {
		for (const g of REGISTERED_TIER_GROUPS) {
			expect(isRequestOnlyGroup(g), g).toBe(false)
		}
	})

	it("every other group is asked for, including the five the old list missed", () => {
		for (const g of EVERY_GROUP.filter((x) => !REGISTERED_TIER_GROUPS.includes(x))) {
			expect(isRequestOnlyGroup(g), g).toBe(true)
		}
		for (const g of ["lew840x-prod-hex", "lew840x-ble-src", "lew840x-esp-src", "lew840x-9160-src", "blg20-demo-hex"]) {
			expect(isRequestOnlyGroup(g), g).toBe(true)
		}
	})

	it("no group, and the wildcard, are never a request", () => {
		expect(isRequestOnlyGroup(undefined)).toBe(false)
		expect(isRequestOnlyGroup("")).toBe(false)
		expect(isRequestOnlyGroup("all")).toBe(false)
	})

	it("a request opens the form for the group's own family", () => {
		expect(requestFamilyFor("lew840x-esp-src")).toBe("lew840x")
		expect(requestFamilyFor("blg20-demo-hex")).toBe("blg20")
	})

	it("the transcript's locked row is told whether an account is signed in, as the home screen's cards are", () => {
		// [15 Sep 2026] The account was in scope at the call site and never passed down, so the row could
		// only branch on revoked and told a registered developer to register. The call site is read as
		// text: a refactor that drops the prop would pass every component test and bring the row back.
		const chatRow = readFileSync(join(process.cwd(), "src", "components", "chat", "ChatRow.tsx"), "utf8")
		const call = /<KbitLockedRow\b[\s\S]*?\/>/.exec(chatRow)?.[0] ?? ""
		expect(call, "ChatRow renders KbitLockedRow").not.toBe("")
		expect(call).toMatch(/signedIn=\{signedIn\}/)
		expect(chatRow).toMatch(/const signedIn = !!adsumAccount/)
		// And the home screen decides the pill the same way, so the two surfaces cannot disagree again.
		const welcome = readFileSync(join(process.cwd(), "src", "components", "chat", "welcome", "WelcomeView.tsx"), "utf8")
		expect(welcome).toMatch(/adsumAccount \|\| isRequestOnlyGroup\(i\.group\) \? ASK_FOR_DETAILS : "Register"/)
	})

	const serverGroups = join(process.cwd(), "..", "..", "Adsum-Backend", "src", "services", "groups.ts")
	it.skipIf(!existsSync(serverGroups))(`the tier here is exactly the server's REGISTERED_TIER (${serverGroups})`, () => {
		const src = readFileSync(serverGroups, "utf8")
		const m = /export const REGISTERED_TIER = \[([^\]]*)\]/.exec(src)
		expect(m, "REGISTERED_TIER not found in the server's groups.ts").toBeTruthy()
		const server = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1])
		expect([...REGISTERED_TIER_GROUPS].sort()).toEqual(server.sort())
	})
})
