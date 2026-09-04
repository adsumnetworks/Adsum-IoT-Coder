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
		// The rule widened on 2026-09-04: a chosen EFFORT is also the developer setting it, because
		// the panel let one be chosen without ever writing a budget. Still never guessed — with
		// neither signal present nothing is sent and DeepSeek's own default stands.
		assert.ok(
			/isV4 && \(budget !== undefined \|\| effort\) \? \{ thinking: \{ type: wantsThinking \? "enabled" : "disabled" \} \} : \{\}/.test(
				handler,
			),
			"with neither a budget nor an effort, no thinking parameter may be sent",
		)
	})

	test("temperature is omitted when thinking is on — the API rejects both together", () => {
		assert.ok(/v4ThinkingOn \? \{\} : \{ temperature: 0 \}/.test(handler), "must not send temperature with thinking on")
	})

	test("only V4 gets the parameter — older DeepSeek models would reject it", () => {
		assert.ok(/const isV4 = model\.id\.startsWith\("deepseek-v4"\)/.test(handler))
	})
})

describe("DeepSeek thinking EFFORT is reachable and correct", () => {
	const handler = fs.readFileSync(HANDLER, "utf8")
	const panel = fs.readFileSync(PANEL, "utf8")
	const api = fs.readFileSync(path.join(process.cwd(), "src", "shared", "api.ts"), "utf8")
	const factory = fs.readFileSync(path.join(process.cwd(), "src", "core", "api", "index.ts"), "utf8")

	test("the levels match DeepSeek's documented values, in order", () => {
		// api-docs.deepseek.com/guides/thinking_mode (checked 2026-08-16): reasoning_effort = low | high | max.
		assert.ok(/DEEPSEEK_EFFORT_LEVELS = \["low", "high", "max"\] as const/.test(api))
	})

	test("the panel offers the level control ONLY when thinking is on", () => {
		assert.ok(/\{thinkingEnabled && \(/.test(panel), "depth is meaningless with thinking off")
		assert.ok(/DEEPSEEK_EFFORT_LEVELS\.map/.test(panel), "levels come from the shared list, not a copy")
		assert.ok(/planModeReasoningEffort.*actModeReasoningEffort/s.test(panel), "must write the reasoning-effort fields")
	})

	test("the factory passes reasoningEffort to the handler", () => {
		// The link that was missing: the panel wrote the field and the DeepSeek case never read it, so the
		// setting would have been saved and silently dropped — the same two-halves failure again.
		const ds = factory.slice(factory.indexOf('case "deepseek":'), factory.indexOf('case "requesty":'))
		assert.ok(
			/reasoningEffort: mode === "plan" \? options\.planModeReasoningEffort : options\.actModeReasoningEffort/.test(ds),
		)
	})

	test("effort is sent only with thinking ON", () => {
		assert.ok(
			/v4ThinkingOn && effort \? \{ reasoning_effort: effort \} : \{\}/.test(handler),
			"reasoning_effort must never accompany thinking: disabled",
		)
	})

	test("an unchosen effort sends nothing, leaving DeepSeek's default of high", () => {
		assert.ok(/v4ThinkingOn && effort \?/.test(handler), "must be conditional on the developer having chosen")
	})
})

describe("an effort chosen with no explicit budget still reaches the wire", () => {
	// [OPERATOR 2026-09-04] "deepseek is currently configured with thinking = low but I see very
	// long thinking sessions". The panel showed the effort dropdown whenever the budget was
	// undefined, so Low could be stored while both handler guards — which required an explicit
	// budget — dropped it. Neither parameter was sent and DeepSeek's server default (enabled at
	// "high") applied. This is the same failure the test above already records, one step along:
	// the control exists now, but the field it depends on was still never written.
	test("the handler treats a chosen effort as intent to think", () => {
		const handler = fs.readFileSync(HANDLER, "utf8")
		assert.ok(
			/const wantsThinking = \(budget \?\? 0\) > 0 \|\| \(budget === undefined && Boolean\(effort\)\)/.test(handler),
			"an effort with no budget must count as thinking on, or a stored Low is silently dropped",
		)
		assert.ok(
			/isV4 && \(budget !== undefined \|\| effort\)/.test(handler),
			"thinking must go on the wire when the developer has expressed either signal",
		)
	})

	test("the settings panel decides 'enabled' by the same rule the handler uses", () => {
		const panel = fs.readFileSync(PANEL, "utf8")
		assert.ok(
			/\(thinkingBudgetTokens \?\? 0\) > 0 \|\| \(thinkingBudgetTokens === undefined && Boolean\(reasoningEffort\)\)/.test(
				panel,
			),
			"panel and handler must agree on what 'thinking is on' means, or the UI lies about the request",
		)
		assert.ok(
			!/currentValue=\{reasoningEffort/.test(panel),
			"the effort dropdown must bind with `value`, like every other provider panel",
		)
	})
})
