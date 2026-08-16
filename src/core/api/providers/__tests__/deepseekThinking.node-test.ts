import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * The DeepSeek thinking toggle, end to end: the Settings control must reach the request body.
 *
 * Reported 2026-08-16: "in the settings there is no thinking enable/disable?" The handler had supported
 * it since the provider work — it sends `thinking: {type}` when thinkingBudgetTokens is set — but the
 * panel never rendered the control, so the field stayed undefined, the parameter was never sent, and
 * DeepSeek's server-side default won every turn with no way to change it. The same shape as the
 * provider being absent from the dropdown: capability present, no path to it.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/api/providers/__tests__/deepseekThinking.node-test.ts
 */

const HANDLER = path.join(process.cwd(), "src", "core", "api", "providers", "deepseek.ts")
const PANEL = path.join(process.cwd(), "webview-ui", "src", "components", "settings", "providers", "DeepSeekProvider.tsx")

describe("DeepSeek thinking toggle is reachable", () => {
	const handler = fs.readFileSync(HANDLER, "utf8")
	const panel = fs.readFileSync(PANEL, "utf8")

	test("the settings panel renders an on/off control", () => {
		assert.ok(panel.includes("getThinkingControl"), "panel must ask which control the model supports")
		assert.ok(/thinkingControl === "onoff"/.test(panel), "panel must render the on/off control")
		assert.ok(/Enable extended thinking/.test(panel), "the control needs a label")
	})

	test("the control writes the SAME field the handler reads", () => {
		// The whole bug class: two correct halves that never met.
		assert.ok(
			/planModeThinkingBudgetTokens.*actModeThinkingBudgetTokens/s.test(panel),
			"panel must write the mode-specific thinking budget fields",
		)
		assert.ok(
			/this\.options\.thinkingBudgetTokens/.test(handler),
			"handler must read thinkingBudgetTokens as the on/off signal",
		)
	})

	test("thinking is sent only when the developer set it — never guessed", () => {
		assert.ok(
			/budget !== undefined \? \{ thinking: \{ type: budget > 0 \? "enabled" : "disabled" \} \} : \{\}/.test(handler),
			"an unset toggle must send no thinking parameter at all, leaving DeepSeek's own default",
		)
	})

	test("temperature is omitted when thinking is on — the API rejects both together", () => {
		assert.ok(/v4ThinkingOn \? \{\} : \{ temperature: 0 \}/.test(handler), "must not send temperature with thinking on")
	})

	test("only V4 gets the parameter — older DeepSeek models would reject it", () => {
		assert.ok(/const isV4 = model\.id\.startsWith\("deepseek-v4"\)/.test(handler))
	})
})
