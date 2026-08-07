import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ClineMessage } from "@/shared/ExtensionMessage"
import { buildCompactionLedger } from "./CompactionLedger"

/**
 * The ledger is what survives a compaction wipe (measured: real gateway runs lost up to 93% of
 * messages with only a 269-byte boilerplate carrying over). It must be deterministic, capped,
 * and resilient to junk input.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/context/context-management/CompactionLedger.test.ts
 */

let ts = 1_000
const say = (sayType: string, text: string): ClineMessage => ({ ts: ts++, type: "say", say: sayType, text }) as ClineMessage

describe("buildCompactionLedger", () => {
	test("extracts the load-bearing state from a realistic message history", () => {
		const msgs: ClineMessage[] = [
			say("task_progress", "- [x] scanner builds\n- [ ] fix NUS dropout"),
			say("command", "west build -p -b nrf52840dk/nrf52840\nlots of output"),
			say("command", "west flash --dev-id 683335182"),
			say("error", "Error: frame CRC mismatch (seq=1042)\nstack..."),
			say("tool", JSON.stringify({ tool: "editedExistingFile", path: "src/gw_uart.c" })),
			say("tool", JSON.stringify({ tool: "newFileCreated", path: "src/gw_proto.h" })),
			say("command_output", "capture written to logs/rtt/device_683335182_20260806_101500.log ok"),
			say("user_feedback", "use RTT observation, not the sniffer"),
			say("task_progress", "- [x] scanner builds\n- [x] capture running\n- [ ] fix NUS dropout"),
		]
		const ledger = buildCompactionLedger(msgs)
		assert.ok(ledger.startsWith("TASK STATE LEDGER"), "has header")
		assert.ok(ledger.includes("capture running"), "LATEST progress wins")
		assert.ok(ledger.includes("west flash --dev-id 683335182"), "commands kept, first line only")
		assert.ok(!ledger.includes("lots of output"), "command bodies dropped")
		assert.ok(ledger.includes("frame CRC mismatch"), "last error signature kept")
		assert.ok(ledger.includes("logs/rtt/device_683335182_20260806_101500.log"), "capture path kept")
		assert.ok(ledger.includes("src/gw_uart.c") && ledger.includes("src/gw_proto.h"), "edited files kept")
		assert.ok(ledger.includes("use RTT observation"), "user guidance kept verbatim")
	})

	test("deterministic: identical input → identical output", () => {
		const msgs = [say("command", "west build"), say("error", "Error: boom")]
		assert.equal(buildCompactionLedger(msgs), buildCompactionLedger(msgs))
	})

	test("hard cap holds against a pathological history", () => {
		const msgs: ClineMessage[] = []
		for (let i = 0; i < 500; i++) {
			msgs.push(say("command", `command-${i} ${"x".repeat(400)}`))
			msgs.push(say("user_feedback", `guidance-${i} ${"y".repeat(400)}`))
			msgs.push(say("command_output", `written logs/rtt/cap_${i}.log`))
		}
		const ledger = buildCompactionLedger(msgs)
		assert.ok(ledger.length <= 2_000, `capped (got ${ledger.length})`)
	})

	test("empty or junk history → empty ledger, no throw", () => {
		assert.equal(buildCompactionLedger([]), "")
		const junk: ClineMessage[] = [
			say("tool", "not-json{{{"),
			say("say_unknown" as never, "x"),
			{ ts: 1, type: "say" } as ClineMessage,
		]
		assert.doesNotThrow(() => buildCompactionLedger(junk))
	})

	test("deduplicates repeated paths, keeps most recent distinct", () => {
		const msgs: ClineMessage[] = []
		for (let i = 0; i < 10; i++) {
			msgs.push(say("tool", JSON.stringify({ tool: "editedExistingFile", path: "main/gw_http.c" })))
		}
		msgs.push(say("tool", JSON.stringify({ tool: "editedExistingFile", path: "main/gw_wifi.c" })))
		const ledger = buildCompactionLedger(msgs)
		const count = (ledger.match(/gw_http\.c/g) || []).length
		assert.equal(count, 1, "repeated file listed once")
		assert.ok(ledger.includes("gw_wifi.c"))
	})
})
