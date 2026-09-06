/**
 * S0 — the agent-handover kill switch (TESTS.md S0-01…S0-08).
 *
 * The feature is OFF for this release but the code stays whole, so what needs guarding is not the
 * handover logic (its own suite still covers that) but the *switch*: every door has to be shut, and a
 * door that opens again later must fail here first.
 *
 * These cases are deliberately about the contract rather than about VS Code: the constant, the package
 * manifest the editor reads, and the host source's guard placement. The webview half of the switch is
 * covered by `webview-ui/.../useRunTarget.disabled.test.tsx`, which can render the hook for real.
 *
 * Run: npm run test:handover-disabled
 */
import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"
import { AGENT_HANDOVER_ENABLED } from "../../shared/handover"

const REPO = path.resolve(__dirname, "..", "..", "..")
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"))
const HANDOVER_COMMANDS = [
	"adsum-iot-coder.handoverToAgent",
	"adsum-iot-coder.continueHandoverHere",
	"adsum-iot-coder.watchHandover",
	"adsum-iot-coder.showHandoverWorklog",
]
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8")

describe("S0 — agent handover is off for this release", () => {
	test("S0-01/02 the switch is off, and it is a compile-time constant", () => {
		assert.equal(AGENT_HANDOVER_ENABLED, false)
		// A `let` or a settings lookup would let a stale workspace config resurrect the feature.
		assert.match(read("src/shared/handover.ts"), /export const AGENT_HANDOVER_ENABLED = false/)
	})

	test("S0-01 detectConductorMode refuses BEFORE reading conductorMode", () => {
		const src = read("src/hosts/vscode/handover/VscodeHandoverService.ts")
		const body = src.slice(src.indexOf("async detectConductorMode("))
		const guard = body.indexOf("AGENT_HANDOVER_ENABLED")
		const setting = body.indexOf('get<string>("conductorMode"')
		assert.ok(guard > -1, "detectConductorMode has no kill-switch guard")
		assert.ok(setting > -1, "conductorMode lookup vanished — update this test")
		assert.ok(
			guard < setting,
			"the guard must precede the settings lookup, or `conductorMode: always` re-enables the feature",
		)
		assert.match(body.slice(guard, guard + 400), /not available in this release/)
	})

	test("S0-03 handOver() is gated at the single door every caller goes through", () => {
		const src = read("src/hosts/vscode/handover/VscodeHandoverService.ts")
		const body = src.slice(src.indexOf("async handOver("))
		const guard = body.indexOf("AGENT_HANDOVER_ENABLED")
		assert.ok(guard > -1 && guard < 600, "handOver() must refuse at the top, before any work")
		assert.match(body.slice(guard, guard + 400), /not available in this release/)
	})

	test("S0-04 the controller stops sending handoverUi at all", () => {
		// Sending `undefined` is what makes the banner, the session view, the recap and useRunTarget's
		// conductor overlay inert without a guard in each of them.
		assert.match(
			read("src/core/controller/index.ts"),
			/handoverUi: AGENT_HANDOVER_ENABLED \? getHandoverUiState\(\) : undefined/,
		)
	})

	test("S0-05 the four commands are hidden from the palette but still registered", () => {
		const palette: Array<{ command: string; when?: string }> = pkg.contributes.menus.commandPalette
		for (const command of HANDOVER_COMMANDS) {
			const entry = palette.find((e) => e.command === command)
			assert.ok(entry, `${command} is not hidden from the command palette`)
			assert.equal(entry?.when, "adsum.agentHandover", `${command} must be gated on the context key`)
		}
		// Still registered: an old keybinding or a vscode:// link must reach a no-op with a message,
		// never "command not found".
		const declared: Array<{ command: string }> = pkg.contributes.commands
		for (const command of HANDOVER_COMMANDS) {
			assert.ok(
				declared.some((c) => c.command === command),
				`${command} was removed from contributes.commands — it must stay registered`,
			)
		}
		assert.match(read("src/extension.ts"), /setContext",\s*"adsum\.agentHandover"/)
	})

	test("S0-06 the provider picker no longer offers external-agent", () => {
		const src = read("webview-ui/src/components/settings/ApiOptions.tsx")
		assert.match(src, /AGENT_HANDOVER_ENABLED \? \["external-agent"\] : \[\]/)
		// The panel is guarded too, so a workspace persisted on that provider opens without a dead panel.
		assert.match(src, /AGENT_HANDOVER_ENABLED && apiConfiguration && selectedProvider === "external-agent"/)
	})

	test("S0-07 the quota card drops the agent escape hatch", () => {
		const src = read("webview-ui/src/components/chat/QuotaExhaustedCard.tsx")
		const button = src.indexOf("Continue on my coding agent")
		assert.ok(button > -1, "the button was deleted rather than gated — it must survive for re-enable")
		assert.ok(src.lastIndexOf("AGENT_HANDOVER_ENABLED &&", button) > -1, "the agent button must be behind the kill switch")
	})

	test("S0-08 conductorMode ships off and says so", () => {
		const setting = pkg.contributes.configuration.properties["adsum-iot-coder.conductorMode"]
		assert.equal(setting.default, "off")
		assert.match(setting.markdownDescription, /Not available in this release/)
		// The enum keeps its three values: a developer who set `always` still has a VALID config.
		assert.deepEqual(setting.enum, ["auto", "always", "off"])
	})

	test("the scaffold handover — a different feature with the same word — is untouched", () => {
		const src = read("src/core/task/tools/handlers/scaffoldHandover.ts")
		assert.ok(!src.includes("AGENT_HANDOVER_ENABLED"), "scaffoldHandover.ts is project scaffolding, not agent handover")
	})
})
