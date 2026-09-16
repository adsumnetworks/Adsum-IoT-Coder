import { describe, expect, it } from "vitest"
import { DEMO_PAIR_PROMPT_BLG20 } from "../welcomeIntents"

// The install button's prompt must name what the agent can actually find. Named loosely ("the demo-pair tool
// bit"), it guessed a bit id that does not exist and told the developer the pair was not open to their account.
describe("BLG20x demo pair install prompt", () => {
	it("names the tool exactly as it is advertised", () => {
		expect(DEMO_PAIR_PROMPT_BLG20).toContain("blg20-hex-demo-pair")
	})
	it("sends the agent to a bit it can read for the limits, not to the tool's descriptor", () => {
		expect(DEMO_PAIR_PROMPT_BLG20).toContain("products/fanstel/blg20x/beats/s2-flash-the-demo.md")
	})
	it("never asks for a writing step before the probes are named", () => {
		expect(DEMO_PAIR_PROMPT_BLG20).toMatch(/ask me which probe is which before you program anything/)
	})
})
