import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { signOut } from "@/services/adsum/AccountState"
import { telemetryService } from "@/services/telemetry"
import type { Controller } from ".."

/** Sign out here AND on the server, so a lost machine actually loses access. */
export async function signOutAccount(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await signOut()
	telemetryService.captureAccountSignedOut()
	await controller.postStateToWebview()
	return Empty.create({})
}
