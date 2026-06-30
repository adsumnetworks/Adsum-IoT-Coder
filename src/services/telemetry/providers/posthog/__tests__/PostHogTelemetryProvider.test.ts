import { expect } from "chai"
import { describe, it } from "mocha"
import type { PostHog } from "posthog-node"
import { ExtensionRegistryInfo } from "@/registry"
import { setDistinctId } from "@/services/logging/distinctId"
import { PostHogTelemetryProvider } from "../PostHogTelemetryProvider"

interface CapturedEvent {
	distinctId: string
	event: string
	properties?: Record<string, unknown>
}

// Minimal PostHog stand-in: records capture() calls so we can assert person key + properties.
function fakeClient(): { client: PostHog; captures: CapturedEvent[] } {
	const captures: CapturedEvent[] = []
	const client = {
		capture: (e: CapturedEvent) => captures.push(e),
	} as unknown as PostHog
	return { client, captures }
}

describe("PostHogTelemetryProvider — identity + app_version (Inc 8 Slices A+B)", () => {
	it("log() keys the event on getDistinctId() — the install_id join key (Slice A)", () => {
		const { client, captures } = fakeClient()
		const provider = new PostHogTelemetryProvider(client)
		setDistinctId("adsum-test-install-id")

		provider.log("free_tier.demo_run_started", { scenario_id: "nus-uart" })

		expect(captures).to.have.length(1)
		expect(captures[0].distinctId).to.equal("adsum-test-install-id")
		expect(captures[0].event).to.equal("free_tier.demo_run_started")
		expect(captures[0].properties?.scenario_id).to.equal("nus-uart")
	})

	it("log() stamps app_version on every event (Slice B)", () => {
		const { client, captures } = fakeClient()
		const provider = new PostHogTelemetryProvider(client)
		setDistinctId("adsum-test-install-id")

		provider.log("some.event")

		expect(captures[0].properties?.app_version).to.equal(ExtensionRegistryInfo.version)
	})

	it("log() stamps iot_platform on every event — the chip-platform dimension (nrf/esp), not the IDE name", () => {
		const { client, captures } = fakeClient()
		const provider = new PostHogTelemetryProvider(client)
		setDistinctId("adsum-test-install-id")

		provider.log("some.event")

		// Regression guard: the global `platform` super-property logs the EDITOR name ("Visual Studio Code"); the
		// CORRECT chip dimension must ride on `iot_platform` (from getCachedWorkspaceSummary → nrf/esp/both/none) so
		// it survives the metadata merge and is present on EVERY event (was previously only on CRA events).
		expect(captures[0].properties).to.have.property("iot_platform")
	})

	it("caller-supplied properties win over the app_version default if they collide", () => {
		const { client, captures } = fakeClient()
		const provider = new PostHogTelemetryProvider(client)
		setDistinctId("adsum-test-install-id")

		provider.log("some.event", { app_version: "override" })

		expect(captures[0].properties?.app_version).to.equal("override")
	})

	it("logRequired() stamps app_version and the _required marker", () => {
		const { client, captures } = fakeClient()
		const provider = new PostHogTelemetryProvider(client)
		setDistinctId("adsum-test-install-id")

		provider.logRequired("free_tier.install_registered", { install_id: "adsum-test-install-id" })

		expect(captures[0].properties?.app_version).to.equal(ExtensionRegistryInfo.version)
		expect(captures[0].properties?._required).to.equal(true)
		expect(captures[0].distinctId).to.equal("adsum-test-install-id")
	})
})
