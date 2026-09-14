import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
	__resetConfigReadiness,
	apiConfigurationReceivedAt,
	CONFIG_WAIT_MS,
	noteApiConfigurationReceived,
	taskGate,
} from "./configReadiness"

/**
 * Host issue H1, 14 September: task 1789352067639 was posted through the seam before the panel had
 * carried the saved route to a remote host; its first three requests ran on the free tier and the route
 * arrived sixteen seconds later.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/test/configReadiness.node-test.ts
 */
describe("the seam waits for the panel's settings before starting a task", () => {
	test("remote window, no settings delivered yet: the task waits rather than starting on the default", () => {
		assert.deepEqual(taskGate({ remote: true, configReceivedAt: null, waitedMs: 0 }), { verdict: "wait" })
		assert.deepEqual(taskGate({ remote: true, configReceivedAt: null, waitedMs: 16_000 }), { verdict: "wait" })
	})

	test("the settings arrive during the wait: the task proceeds", () => {
		__resetConfigReadiness()
		assert.equal(apiConfigurationReceivedAt(), null)
		noteApiConfigurationReceived(5)
		noteApiConfigurationReceived(9) // only the first delivery counts
		assert.equal(apiConfigurationReceivedAt(), 5)
		assert.deepEqual(taskGate({ remote: true, configReceivedAt: apiConfigurationReceivedAt(), waitedMs: 100 }), {
			verdict: "proceed",
		})
		__resetConfigReadiness()
	})

	test("they never arrive: a clear 409 after the bound, not a hang and not a run on the default", () => {
		const g = taskGate({ remote: true, configReceivedAt: null, waitedMs: CONFIG_WAIT_MS })
		assert.equal(g.verdict, "refuse")
		assert.equal(g.verdict === "refuse" && g.status, 409)
		assert.match(g.verdict === "refuse" ? g.error : "", /saved provider settings/)
	})

	test("a local window reads its settings at activation and is never held", () => {
		assert.deepEqual(taskGate({ remote: false, configReceivedAt: null, waitedMs: 0 }), { verdict: "proceed" })
	})
})
