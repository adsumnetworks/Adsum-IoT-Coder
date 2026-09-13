import { strict as assert } from "node:assert"
import { kbitUnavailableMessage } from "../kbitUnavailable"

/**
 * The falsifier for the worst string in the product.
 *
 * A developer whose account could not open a bit was told it did not exist, and then advised to
 * publish it to our own registry and to set a developer environment variable. These cases say:
 * never those words, always the one door.
 */
const ANTI = " Do NOT reconstruct or improvise this Adsum workflow."
const BANNED = ["not found", "does not exist", "not in the registry", "ADSUM_KBIT_LOCAL", "publish", "402"]

describe("a bit the account cannot open", () => {
	it("is never reported as missing, and never hands over our machinery", () => {
		for (const isDev of [false, true]) {
			const msg = kbitUnavailableMessage({
				antiImprovise: ANTI,
				displayPath: "iot-knowledge/products/fanstel/blg20x/adv/advanced-full.md",
				isDev,
				reason: "locked",
			})
			for (const banned of BANNED) {
				assert.ok(!msg.toLowerCase().includes(banned.toLowerCase()), `locked message must not say "${banned}": ${msg}`)
			}
			assert.ok(msg.includes("ask for more details"), "the one action must be named")
			assert.ok(msg.includes(ANTI.trim()), "the anti-improvise rule must survive")
			// Not even the id, the group or a size of the thing they cannot have.
			assert.ok(!/advanced-full|blg20|[0-9a-f]{16}|\d+\s?(KB|MB|bytes)/i.test(msg), `no id or size: ${msg}`)
		}
	})

	it("says what we know, and not what we do not, when the registry has no such bit", () => {
		const msg = kbitUnavailableMessage({
			antiImprovise: ANTI,
			displayPath: "iot-knowledge/products/typo.md",
			pathHint: "Retry with the exact path: products/fanstel/blg20x/PRODUCT.md. ",
			reason: "not-in-registry",
		})
		for (const banned of BANNED) {
			assert.ok(!msg.toLowerCase().includes(banned.toLowerCase()), `must not say "${banned}": ${msg}`)
		}
		assert.ok(msg.includes("ask for more details"), "the same door, named the same way")
		assert.ok(msg.includes("Retry with the exact path"), "a real path hint still reaches the agent")
	})

	it("keeps the developer hint for developer builds only", () => {
		const dev = kbitUnavailableMessage({ antiImprovise: ANTI, displayPath: "x.md", isDev: true, reason: "not-in-registry" })
		const customer = kbitUnavailableMessage({ antiImprovise: ANTI, displayPath: "x.md", reason: "not-in-registry" })
		assert.ok(dev.includes("ADSUM_KBIT_LOCAL"), "a developer build may still say it")
		assert.ok(!customer.includes("ADSUM_KBIT_LOCAL"), "a customer build never may")
	})

	it("still tells an unreachable registry apart from everything else", () => {
		const msg = kbitUnavailableMessage({ antiImprovise: ANTI, displayPath: "x.md", reason: "unreachable" })
		assert.ok(msg.includes("unreachable"), "the network case keeps its own words")
		assert.ok(!msg.includes("ADSUM_KBIT_LOCAL"))
	})
})
