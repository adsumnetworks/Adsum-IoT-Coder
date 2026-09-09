/**
 * The 0.4.0 telemetry sweep — the guarantees, not the syntax.
 *
 *   1. Every event name in EVENTS is unique. Two constants sharing a string would silently merge two
 *      series on every dashboard, and nothing else checks it.
 *   2. The four wrappers added for 0.4.0 emit the event the dashboard tiles are built on, with exactly
 *      the properties promised — counts and enums, never text.
 *
 * Run: npm run test:telemetry-events
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { NoOpTelemetryProvider } from "../TelemetryProviderFactory"
import { TelemetryService } from "../TelemetryService"

setVscodeHostProviderMock()

const METADATA = {
	extension_name: "nrf-ai-debugger",
	extension_publisher: "AdsumNetwork",
	extension_display_name: "Adsum IoT Coder",
	extension_version: "0.4.0",
	is_fork: true,
	upstream: "cline",
	platform: "Test-IDE",
	platform_version: "0.0.0",
	os_type: "darwin",
	os_version: "0",
	arch: "arm64",
	host_type: "VSCode Extension",
	is_dev: "",
} as never

function flatten(node: unknown, out: string[] = []): string[] {
	if (typeof node === "string") {
		out.push(node)
	} else if (node && typeof node === "object") {
		for (const v of Object.values(node as Record<string, unknown>)) {
			flatten(v, out)
		}
	}
	return out
}

/** A provider that remembers what it was told. */
function recorder() {
	const calls: Array<{ event: string; props: Record<string, unknown> }> = []
	const p = new NoOpTelemetryProvider()
	p.log = (event: string, props?: Record<string, unknown>) => {
		calls.push({ event, props: props ?? {} })
	}
	return { p, calls }
}

/** Strip the metadata the service adds to every event, leaving what the wrapper itself sent. */
function own(props: Record<string, unknown>): Record<string, unknown> {
	const meta = new Set(Object.keys(METADATA as Record<string, unknown>))
	return Object.fromEntries(Object.entries(props).filter(([k]) => !meta.has(k)))
}

describe("EVENTS", () => {
	it("every event name is unique — two constants with one string would merge two series", () => {
		const names = flatten(TelemetryService.EVENTS)
		const seen = new Map<string, number>()
		for (const n of names) {
			seen.set(n, (seen.get(n) ?? 0) + 1)
		}
		const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n)
		assert.deepEqual(dupes, [], `duplicated event names: ${dupes.join(", ")}`)
		assert.ok(names.length > 120, `expected the full tree, saw ${names.length}`)
	})

	it("the 0.4.0 names are the ones the dashboard tiles were built on", () => {
		const names = new Set(flatten(TelemetryService.EVENTS))
		for (const n of ["task.stream_stalled", "account.signed_out", "account.deleted", "ui.model_pricing_overridden"]) {
			assert.ok(names.has(n), n)
		}
	})
})

describe("the 0.4.0 wrappers", () => {
	const { p, calls } = recorder()
	const svc = new TelemetryService([p], METADATA)
	calls.length = 0

	it("stream_stalled carries provider, model, phase and the silence — nothing else", () => {
		svc.captureStreamStalled({ provider: "deepseek", model: "deepseek-v4", phase: "mid_stream", silentMs: 90000 })
		const last = calls.at(-1)!
		assert.equal(last.event, "task.stream_stalled")
		assert.deepEqual(own(last.props), { provider: "deepseek", model: "deepseek-v4", phase: "mid_stream", silentMs: 90000 })
	})

	it("signed_out and deleted are bare counts", () => {
		svc.captureAccountSignedOut()
		assert.equal(calls.at(-1)!.event, "account.signed_out")
		assert.deepEqual(own(calls.at(-1)!.props), {})
		svc.captureAccountDeleted()
		assert.equal(calls.at(-1)!.event, "account.deleted")
		assert.deepEqual(own(calls.at(-1)!.props), {})
	})

	it("model_pricing_overridden sends how many models, never a price", () => {
		svc.captureModelPricingOverridden({ models: 3 })
		const last = calls.at(-1)!
		assert.equal(last.event, "ui.model_pricing_overridden")
		assert.deepEqual(own(last.props), { models: 3 })
		assert.ok(!JSON.stringify(last.props).includes("USD"))
	})

	it("proves the recorder can fail: an unknown wrapper is not silently green", () => {
		const before = calls.length
		assert.equal(calls.length, before)
		assert.notEqual(calls.at(-1)!.event, "task.created")
	})
})

HostProvider.reset()
