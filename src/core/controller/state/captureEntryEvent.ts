import { Empty } from "@shared/proto/cline/common"
import { EntryEventRequest } from "@shared/proto/cline/state"
import { telemetryService } from "../../../services/telemetry"
import type { Controller } from "../index"

/**
 * Record one entry-surface measurement.
 *
 * The cockpit replaced a screen whose value nobody had measured, so it ships with four counters:
 * how long until the first prompt, how often a resume is used, how often the drawer is opened,
 * and how often a run is actually started. Without them "did this help" is a matter of taste, and
 * the pre-committed reversal rule — cards return if run-starts fall below the old baseline — has
 * nothing to read.
 *
 * The webview has no telemetry client, and should not: whether telemetry is on at all is a host
 * decision, and routing through here keeps that single gate.
 */
export async function captureEntryEvent(_controller: Controller, request: EntryEventRequest): Promise<Empty> {
	try {
		telemetryService.capture({ event: request.event, properties: request.properties ?? {} })
	} catch (error) {
		// A counter must never take the surface down with it.
		console.error("captureEntryEvent failed:", error)
	}
	return Empty.create({})
}
