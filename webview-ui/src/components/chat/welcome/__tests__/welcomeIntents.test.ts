import { describe, it } from "mocha"
import "should"
import { buildIntentPrompt, getTenure, type IntentId, NO_PROJECT_INTENTS, PROJECT_INTENTS } from "../welcomeIntents"

describe("getTenure", () => {
	it("taskCount=0, showAnnouncement=false → new", () => {
		getTenure({ taskCount: 0, showAnnouncement: false }).should.equal("new")
	})
	it("taskCount=0, showAnnouncement=true → new (new wins over dormant)", () => {
		getTenure({ taskCount: 0, showAnnouncement: true }).should.equal("new")
	})
	it("taskCount=3, showAnnouncement=true → dormant", () => {
		getTenure({ taskCount: 3, showAnnouncement: true }).should.equal("dormant")
	})
	it("taskCount=3, showAnnouncement=false → returning", () => {
		getTenure({ taskCount: 3, showAnnouncement: false }).should.equal("returning")
	})
	it("taskCount=1, showAnnouncement=false → returning (1 task is not new)", () => {
		getTenure({ taskCount: 1, showAnnouncement: false }).should.equal("returning")
	})
})

describe("buildIntentPrompt", () => {
	const ids: IntentId[] = ["prototype", "addFeature", "debug", "buildFlash", "testValidate", "demo"]
	for (const id of ids) {
		it(`${id} returns a non-empty string`, () => {
			buildIntentPrompt(id).should.be.a.String().and.not.equal("")
		})
	}

	it("addFeature interpolates projectName", () => {
		buildIntentPrompt("addFeature", "my_app").should.containEql("my_app")
	})

	it("buildFlash interpolates projectName", () => {
		buildIntentPrompt("buildFlash", "my_app").should.containEql("my_app")
	})

	it("testValidate interpolates projectName", () => {
		buildIntentPrompt("testValidate", "my_app").should.containEql("my_app")
	})

	it("addFeature falls back gracefully when projectName omitted (no undefined in string)", () => {
		const result = buildIntentPrompt("addFeature")
		result.should.not.containEql("undefined")
		result.should.be.a.String()
	})

	it("buildFlash falls back gracefully when projectName omitted", () => {
		buildIntentPrompt("buildFlash").should.not.containEql("undefined")
	})

	it("testValidate falls back gracefully when projectName omitted", () => {
		buildIntentPrompt("testValidate").should.not.containEql("undefined")
	})

	it("prototype does not change with projectName (it is not project-scoped)", () => {
		buildIntentPrompt("prototype").should.equal(buildIntentPrompt("prototype", "irrelevant"))
	})
})

describe("NO_PROJECT_INTENTS", () => {
	it("excludes project-only intent ids", () => {
		const ids = NO_PROJECT_INTENTS.map((d) => d.id)
		ids.should.not.containEql("addFeature")
		ids.should.not.containEql("debug")
		ids.should.not.containEql("buildFlash")
		ids.should.not.containEql("testValidate")
	})

	it("includes prototype", () => {
		NO_PROJECT_INTENTS.map((d) => d.id).should.containEql("prototype")
	})
})

describe("PROJECT_INTENTS", () => {
	it("has exactly one primary intent", () => {
		const primaries = PROJECT_INTENTS.filter((d) => d.primary)
		primaries.length.should.equal(1)
	})

	it("addFeature is the primary", () => {
		PROJECT_INTENTS.find((d) => d.primary)?.id.should.equal("addFeature")
	})

	it("includes all four project-state intents", () => {
		const ids = PROJECT_INTENTS.map((d) => d.id)
		ids.should.containEql("addFeature")
		ids.should.containEql("debug")
		ids.should.containEql("buildFlash")
		ids.should.containEql("testValidate")
	})

	it("excludes no-project intents", () => {
		PROJECT_INTENTS.map((d) => d.id).should.not.containEql("prototype")
		PROJECT_INTENTS.map((d) => d.id).should.not.containEql("openProject")
	})
})
