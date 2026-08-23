import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import {
	buildEngineConfig,
	EXPORTED_OPERATING_KEYS,
	INSTALL_ID_KEY,
	PROVENANCE_FILE,
	readEngineConfigProvenance,
	writeEngineConfig,
} from "./EngineConfigExport"

/**
 * This export is the only path by which a developer's provider key reaches a headless run. The tests that matter
 * are therefore about what crosses and what does not: secrets split from settings exactly as the extension does it,
 * global state stays behind, the free-tier credential comes along, and the provenance record can be shown to anyone
 * without showing them a key.
 */

const KEY = "zai-NOTAREALKEY-1234567890"

const LIVE_API_CONFIG = {
	actModeApiProvider: "zai-coding-plan",
	planModeApiProvider: "zai-coding-plan",
	actModeApiModelId: "glm-5.2",
	planModeApiModelId: "glm-5.2",
	actModeThinkingBudgetTokens: 1024,
	zaiApiKey: KEY,
	openRouterApiKey: "", // a blank field is not a key
	authNonce: "one-shot-oauth-nonce", // a secret, but meaningless headless
	taskHistory: [{ id: "1", task: "flash it" }], // GLOBAL STATE — must never cross
	userInfo: { email: "someone@example.com" },
	demoAutoStart: true,
}

describe("buildEngineConfig", () => {
	test("secrets and settings split the way StateManager.setApiConfiguration does", () => {
		const b = buildEngineConfig({ apiConfiguration: LIVE_API_CONFIG })
		assert.deepEqual(b.secrets, { zaiApiKey: KEY }, "only the real key is a secret; blank and nonce are dropped")
		assert.equal(b.settings.actModeApiProvider, "zai-coding-plan")
		assert.equal(b.settings.actModeApiModelId, "glm-5.2")
		assert.equal(b.settings.actModeThinkingBudgetTokens, 1024)
		assert.equal(b.provider, "zai-coding-plan")
		assert.equal(b.model, "glm-5.2")
	})

	test("global state never crosses — not even when handed in", () => {
		const b = buildEngineConfig({ apiConfiguration: LIVE_API_CONFIG })
		for (const k of ["taskHistory", "userInfo", "demoAutoStart"]) {
			assert.ok(!(k in b.settings), `${k} must not be exported`)
			assert.ok(!(k in b.secrets), `${k} must not be exported as a secret either`)
		}
	})

	test("the free tier's credential is the one named exception", () => {
		const b = buildEngineConfig({
			apiConfiguration: { actModeApiProvider: "adsum-free" },
			installId: "adsum-0000-1111",
		})
		assert.equal(b.settings[INSTALL_ID_KEY], "adsum-0000-1111")
		assert.equal(b.provider, "adsum-free")
		assert.ok(b.model, "the free tier names its single model so the run is attributable")
		assert.deepEqual(b.secrets, {}, "the free tier has no secret — the install id IS the credential")
	})

	test("operating settings cross; a non-settings key in that list fails loudly", () => {
		const b = buildEngineConfig({
			apiConfiguration: LIVE_API_CONFIG,
			operating: { mode: "act", terminalOutputLineLimit: 500 },
		})
		assert.equal(b.settings.mode, "act")
		assert.equal(b.settings.terminalOutputLineLimit, 500)
		assert.throws(
			() => buildEngineConfig({ apiConfiguration: {}, operating: { taskHistory: [] } }),
			/not a settings key/,
			"a renamed or mis-listed key must fail, never leak",
		)
	})

	test("every key in EXPORTED_OPERATING_KEYS is a settings key today", () => {
		// If a key is ever moved out of SETTINGS_FIELDS, this is the test that says so.
		const operating = Object.fromEntries(EXPORTED_OPERATING_KEYS.map((k) => [k, "x"]))
		assert.doesNotThrow(() => buildEngineConfig({ apiConfiguration: {}, operating }))
	})

	test("provider-specific model ids are read for the provider that uses them", () => {
		const b = buildEngineConfig({
			apiConfiguration: {
				actModeApiProvider: "openrouter",
				actModeOpenRouterModelId: "deepseek/deepseek-v4-pro",
				actModeApiModelId: "should-not-win",
			},
		})
		assert.equal(b.model, "deepseek/deepseek-v4-pro")
	})
})

describe("writeEngineConfig", () => {
	const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "adsum-engine-cfg-"))
	const meta = {
		extensionId: "adsumnetwork.nrf-ai-debugger",
		extensionVersion: "0.3.1",
		editor: "Visual Studio Code",
		remote: "ssh-remote",
		host: "adsum-bench",
	}

	test("writes both stores, mode 0600, and a provenance with names only", () => {
		const dir = tmp()
		const b = buildEngineConfig({ apiConfiguration: LIVE_API_CONFIG, operating: { mode: "act" } })
		const r = writeEngineConfig(dir, b, meta)

		const gs = JSON.parse(fs.readFileSync(path.join(dir, "globalState.json"), "utf8"))
		const sc = JSON.parse(fs.readFileSync(path.join(dir, "secrets.json"), "utf8"))
		assert.equal(gs.actModeApiProvider, "zai-coding-plan")
		assert.equal(sc.zaiApiKey, KEY)
		assert.ok(!("taskHistory" in gs))

		if (process.platform !== "win32") {
			for (const f of ["globalState.json", "secrets.json", PROVENANCE_FILE]) {
				assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, `${f} must be owner-only`)
			}
		}

		const prov = fs.readFileSync(path.join(dir, PROVENANCE_FILE), "utf8")
		assert.ok(!prov.includes(KEY), "a provenance record must never contain a secret value")
		assert.deepEqual(r.provenance.secretKeys, ["zaiApiKey"])
		assert.equal(r.provenance.provider, "zai-coding-plan")
		assert.equal(r.provenance.model, "glm-5.2")
		assert.equal(r.provenance.extensionVersion, "0.3.1")
		assert.deepEqual(readEngineConfigProvenance(dir), r.provenance)
	})

	test("merges: a runner's own keys survive an adopt, and a re-adopt overwrites only what it owns", () => {
		const dir = tmp()
		fs.writeFileSync(
			path.join(dir, "globalState.json"),
			JSON.stringify({ autoApprovalSettings: { version: 83, enabled: true }, actModeApiProvider: "deepseek" }),
		)
		writeEngineConfig(dir, buildEngineConfig({ apiConfiguration: LIVE_API_CONFIG }), meta)
		const gs = JSON.parse(fs.readFileSync(path.join(dir, "globalState.json"), "utf8"))
		assert.deepEqual(gs.autoApprovalSettings, { version: 83, enabled: true }, "harness override kept")
		assert.equal(gs.actModeApiProvider, "zai-coding-plan", "provider re-adopted")
	})

	test("an existing file with the wrong mode is tightened, not trusted", () => {
		if (process.platform === "win32") {
			return
		}
		const dir = tmp()
		const f = path.join(dir, "secrets.json")
		fs.writeFileSync(f, "{}", { mode: 0o644 })
		writeEngineConfig(dir, buildEngineConfig({ apiConfiguration: LIVE_API_CONFIG }), meta)
		assert.equal(fs.statSync(f).mode & 0o777, 0o600)
	})

	test("no provenance → null, never a throw", () => {
		assert.equal(readEngineConfigProvenance(tmp()), null)
	})
})
