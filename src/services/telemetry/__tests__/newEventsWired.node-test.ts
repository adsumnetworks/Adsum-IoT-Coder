import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

// `process.cwd()` rather than `__dirname`: mocha loads this file as an ES module, where __dirname does
// not exist, and the whole suite aborted on it — "Exception during run", zero tests reported, which
// reads as a broken repo rather than one broken file. The sibling announcementSurfaces test already
// resolves the root this way, and both runners start at the repo root.
const REPO_ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8")

/**
 * An event that exists and is never fired is worse than no event: it passes its unit test, appears in the
 * catalogue, and reports nothing. Fourteen of them were in this state before 0.3.1 — the whole free-tier
 * upgrade funnel among them. These assertions pin the call site, not the definition.
 */
describe("the events added for this release are wired to real code", () => {
	const service = read("src/services/telemetry/TelemetryService.ts")

	test("chipFamilies leaves both environment detectors", () => {
		assert.match(read("src/services/nrf/EnvironmentDetector.ts"), /chipFamilies:\s*chipFamilyList\(/)
		assert.match(read("src/services/esp/EspEnvironmentDetector.ts"), /chipFamilies:\s*chipFamilyList\(/)
		// And the event actually carries it, rather than the detector computing it into a void.
		assert.match(service, /chipFamilies:\s*args\.chipFamilies/)
	})

	test("the handover reports itself, with the surface that launched it", () => {
		const handler = read("src/core/controller/state/handoverToAgent.ts")
		assert.match(handler, /telemetryService\.captureHandoverStarted\(/)
		assert.match(handler, /source,\s*intentId,\s*platform/)
		// The quota card is the free tier's other exit beside adding a key; it must be attributable.
		assert.match(read("webview-ui/src/components/chat/QuotaExhaustedCard.tsx"), /source:\s*"quota_card"/)
	})

	test("the upgrade prompt records being shown, once per version", () => {
		const handler = read("src/core/controller/ui/onDidShowAnnouncement.ts")
		assert.match(handler, /captureFreeTierUpgradePromptShown\(/)
		// Guarded on the transition: the same endpoint also serves dismissal, so an unguarded capture
		// would count every dismissal as another impression.
		assert.match(handler, /alreadyShown/)
	})

	test("events whose surface was removed are gone, not left firing into nothing", () => {
		// The card's "See it live" CTA was deleted deliberately, and dismissal shares one RPC with showing.
		assert.doesNotMatch(service, /UPGRADE_PROMPT_DEMO_CLICKED/)
		assert.doesNotMatch(service, /UPGRADE_PROMPT_DISMISSED/)
	})
})
