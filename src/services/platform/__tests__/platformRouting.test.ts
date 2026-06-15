import { describe, it } from "mocha"
import "should"
import { espToolActive, nrfToolActive, routePlatform } from "../platformRouting"

describe("platformRouting", () => {
	describe("routePlatform", () => {
		it("esp workspace → ESP knowledge only, no multi-platform note", () => {
			const r = routePlatform("esp")
			r.loadEsp.should.be.true()
			r.loadNrf.should.be.false()
			r.multiPlatform.should.be.false()
		})

		it("nrf workspace → nRF knowledge only, no multi-platform note", () => {
			const r = routePlatform("nrf")
			r.loadNrf.should.be.true()
			r.loadEsp.should.be.false()
			r.multiPlatform.should.be.false()
		})

		it("both workspace → BOTH knowledge sets, multi-platform note", () => {
			const r = routePlatform("both")
			r.loadNrf.should.be.true()
			r.loadEsp.should.be.true()
			r.multiPlatform.should.be.true()
		})

		it("none workspace → no platform knowledge, no note", () => {
			const r = routePlatform("none")
			r.loadNrf.should.be.false()
			r.loadEsp.should.be.false()
			r.multiPlatform.should.be.false()
		})
	})

	describe("nrfToolActive — nRF device tool advertised for nrf, both, none (not pure esp)", () => {
		it("true for nrf", () => nrfToolActive("nrf").should.be.true())
		it("true for both", () => nrfToolActive("both").should.be.true())
		it("true for none (neutral default keeps nRF tooling)", () => nrfToolActive("none").should.be.true())
		it("false for esp", () => nrfToolActive("esp").should.be.false())
	})

	describe("espToolActive — ESP device tool advertised for esp, both and none (not pure nrf)", () => {
		it("true for esp", () => espToolActive("esp").should.be.true())
		it("true for both", () => espToolActive("both").should.be.true())
		it("true for none (empty workspace can scaffold an ESP prototype from scratch)", () =>
			espToolActive("none").should.be.true())
		it("false for nrf (an nRF-only workspace never advertises the ESP tool)", () => espToolActive("nrf").should.be.false())
	})

	describe("nrf/esp tool gates are mutually consistent with routePlatform", () => {
		it("esp: esp tool on, nrf tool off, esp knowledge on", () => {
			espToolActive("esp").should.be.true()
			nrfToolActive("esp").should.be.false()
			routePlatform("esp").loadEsp.should.be.true()
		})
		it("both: both tools on", () => {
			espToolActive("both").should.be.true()
			nrfToolActive("both").should.be.true()
		})
	})
})
