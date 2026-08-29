import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { BUNDLED_PEOPLE, buildPeopleIndex, linksFor } from "./people"

describe("the credit roster", () => {
	test("offline, the bundled baseline is what a credit gets", () => {
		const index = buildPeopleIndex(null)
		assert.equal(index["Omar Morceli"], BUNDLED_PEOPLE["Omar Morceli"])
		assert.equal(index["Nebil Alamin"], "https://www.linkedin.com/in/nebil-alamin-71910521/")
	})

	/**
	 * The whole point of moving this out of the extension: a contributor added after a release must be
	 * creditable without one.
	 */
	test("a person the build never heard of is credited from the registry", () => {
		const index = buildPeopleIndex([{ handle: "new-dev", name: "New Dev", url: "https://example.com/in/new" }])
		assert.equal(index["New Dev"], "https://example.com/in/new")
		assert.equal(index["new-dev"], "https://example.com/in/new", "a bit may credit by handle alone")
	})

	test("a corrected link reaches an installed extension — the registry wins over the bundled copy", () => {
		const index = buildPeopleIndex([{ handle: "omar", name: "Omar Morceli", url: "https://example.com/in/omar-new" }])
		assert.equal(index["Omar Morceli"], "https://example.com/in/omar-new")
	})

	/**
	 * A row with no URL is legitimate — plain text is honest. It must not blank out a link that already
	 * works offline, which would be a silent regression for everyone the registry has not filled in yet.
	 */
	test("a registry row with no URL does not erase a bundled link", () => {
		const index = buildPeopleIndex([{ handle: "omar", name: "Omar Morceli", url: null }])
		assert.equal(index["Omar Morceli"], BUNDLED_PEOPLE["Omar Morceli"])
	})

	test("a malformed or empty roster leaves the baseline standing", () => {
		assert.deepEqual(buildPeopleIndex([]), { ...BUNDLED_PEOPLE })
		assert.deepEqual(buildPeopleIndex(null), { ...BUNDLED_PEOPLE })
	})

	describe("what travels with one credit line", () => {
		const index = buildPeopleIndex(null)

		test("only the names on the line, so the payload stays small", () => {
			const links = linksFor(["Omar Morceli", "Nebil Alamin"], index)
			assert.deepEqual(Object.keys(links ?? {}).sort(), ["Nebil Alamin", "Omar Morceli"])
		})

		test("nobody resolvable means nothing is sent at all", () => {
			assert.equal(linksFor(["Adsum authoring team"], index), undefined)
			assert.equal(linksFor([undefined, ""], index), undefined)
		})

		test("an unknown co-author does not suppress the known one", () => {
			const links = linksFor(["Omar Morceli", "Someone New"], index)
			assert.deepEqual(Object.keys(links ?? {}), ["Omar Morceli"])
		})
	})
})
