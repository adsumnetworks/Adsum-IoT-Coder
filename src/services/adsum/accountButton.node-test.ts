/**
 * The account icon in the panel header, and its menu.
 *
 * Operator, 14 Sep: nothing in the panel showed whether anyone was signed in. The icon sits between history and
 * settings, follows the host's account state, and its menu speaks in the Account section's words.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/services/adsum/accountButton.node-test.ts
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { groupLine } from "@shared/adsumGroupWords"
import { accountMenuItems } from "./accountMenu"

const root = path.resolve(__dirname, "../../..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

describe("H — the account icon", () => {
	test("H-01 signed out: the plain account glyph, titled Sign in, between history and settings", () => {
		const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === "adsum.account.signIn")
		assert.equal(cmd.icon, "$(account)")
		assert.equal(cmd.title, "Sign in")
		const rows = pkg.contributes.menus["view/title"] as { command: string; group: string; when: string }[]
		const order = (id: string) => Number(rows.find((r) => r.command === id)?.group.split("@")[1])
		const signIn = rows.find((r) => r.command === "adsum.account.signIn")
		assert.match(signIn?.when ?? "", /!adsum\.signedIn/)
		assert.ok(order("adsum-iot-coder.historyButtonClicked") < order("adsum.account.signIn"))
		assert.ok(order("adsum.account.signIn") < order("adsum-iot-coder.settingsButtonClicked"))
	})

	test("H-02 signed in: the same glyph with an identity-colour dot, shown only when signed in", () => {
		const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === "adsum.account.menu")
		const rows = pkg.contributes.menus["view/title"] as { command: string; when: string }[]
		assert.match(rows.find((r) => r.command === "adsum.account.menu")?.when ?? "", /(^|&&\s*)adsum\.signedIn\b/)
		const glyph = readFileSync(path.join(root, "node_modules/@vscode/codicons/src/icons/account.svg"), "utf8")
		const d = /d="([^"]+)"/.exec(glyph)?.[1]
		for (const theme of ["light", "dark"] as const) {
			const svg = readFileSync(path.join(root, cmd.icon[theme]), "utf8")
			assert.ok(d && svg.includes(d), `${theme}: the same account glyph as the signed-out icon`)
			assert.match(svg, /<circle[^>]*fill="#D76947"/, `${theme}: the identity-colour dot`)
		}
	})

	test("H-03 the menu names the account, says what it opens in words, and offers settings and sign-out", () => {
		const items = accountMenuItems(
			{
				email: "dev@example.com",
				name: "",
				emailVerified: true,
				groups: ["cellular-advanced", "edge-ai-advanced"],
				fetchedAt: 0,
			},
			groupLine,
		)
		assert.equal(items[0].label, "Signed in as dev@example.com")
		const opens = items.find((i) => i.label === "Opens")
		assert.equal(opens?.description, "Advanced cellular · On-device inference")
		assert.ok(!items.some((i) => `${i.label} ${i.description ?? ""}`.includes("cellular-advanced")), "never a raw group id")
		assert.deepEqual(
			items.filter((i) => i.action).map((i) => [i.label, i.action]),
			[
				["Account settings", "settings"],
				["Sign out", "signout"],
			],
		)
	})
})
