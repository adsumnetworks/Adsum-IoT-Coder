import { Controller } from "@core/controller"
import * as vscode from "vscode"
import { Logger } from "@/services/logging/Logger"

/**
 * A test aid, not a feature: write the provider routing fields from JSON, so a bench can be put into
 * a known configuration repeatably.
 *
 * It exists because the settings toolkit's controls only accept a genuine gesture — neither a
 * synthetic event nor a direct write to the remote window's state store reaches them — and fifty-three
 * bit runs cannot start with someone typing six values by hand and hoping they typed them the same
 * way as last time.
 *
 * Guarded three ways: it is registered only in a development build, it accepts ONLY the fields listed
 * below, and it writes nothing at all if any key is unrecognised. It logs exactly what it wrote,
 * because a test aid that changes a configuration silently is a way to lose an afternoon.
 */

/** The only keys this aid may write. An unknown key is refused, never ignored. */
export const ROUTING_TEST_FIELDS = [
	"openRouterModelId",
	"openRouterSellerOrder",
	"openRouterOnlyTheseSellers",
	"openRouterMaxInputPrice",
	"openRouterMaxOutputPrice",
	"openRouterRequireToolCalls",
	"openRouterExtraBody",
	"openRouterProviderSorting",
] as const

export type RoutingTestField = (typeof ROUTING_TEST_FIELDS)[number]

export interface RoutingTestPayload {
	ok: true
	fields: Partial<Record<RoutingTestField, string | boolean>>
}
export interface RoutingTestRefusal {
	ok: false
	reason: string
}

/**
 * Parse and vet the argument. Pure, so the rules are testable without a window.
 *
 * A refusal names the offending key: the point of a test aid is that you know what it did, and
 * "something went wrong" is the opposite of that.
 */
export function parseRoutingTestPayload(raw: unknown): RoutingTestPayload | RoutingTestRefusal {
	let value: unknown = raw
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw)
		} catch (err) {
			return { ok: false, reason: `not JSON: ${(err as Error).message}` }
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ok: false, reason: "expected a JSON object of routing fields" }
	}
	const fields: Partial<Record<RoutingTestField, string | boolean>> = {}
	for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
		if (!(ROUTING_TEST_FIELDS as readonly string[]).includes(key)) {
			return { ok: false, reason: `unknown field "${key}" — this aid writes only: ${ROUTING_TEST_FIELDS.join(", ")}` }
		}
		if (typeof v !== "string" && typeof v !== "boolean") {
			return { ok: false, reason: `field "${key}" must be a string or a boolean` }
		}
		fields[key as RoutingTestField] = v
	}
	if (Object.keys(fields).length === 0) {
		return { ok: false, reason: "nothing to write" }
	}
	return { ok: true, fields }
}

/** True only for a development build. Production never sees this command at all. */
export function shouldRegisterRoutingTestAid(isDev: string | undefined): boolean {
	return isDev === "true"
}

export function registerRoutingTestAid(controller: Controller): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand("adsum.dev.writeRoutingForTest", async (arg?: unknown) => {
			const input =
				arg ??
				(await vscode.window.showInputBox({
					prompt: "Routing fields as JSON (development test aid)",
					value: '{"openRouterSellerOrder":"baidu, baseten, parasail"}',
				}))
			const parsed = parseRoutingTestPayload(input)
			if (!parsed.ok) {
				vscode.window.showErrorMessage(`Routing test aid refused: ${parsed.reason}`)
				Logger.log(`[dev] routing test aid refused: ${parsed.reason}`)
				return
			}
			const config = { ...controller.stateManager.getApiConfiguration(), ...parsed.fields }
			controller.stateManager.setApiConfiguration(config as never)
			await controller.postStateToWebview()
			const written = Object.entries(parsed.fields)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(", ")
			Logger.log(`[dev] routing test aid wrote: ${written}`)
			vscode.window.showInformationMessage(`Routing test aid wrote: ${written}`)
		}),
	]
}
