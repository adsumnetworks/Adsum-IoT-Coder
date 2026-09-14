import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { pasteSignInLink as completeFromLink } from "@/services/adsum/signInLink"
import type { Controller } from ".."

/**
 * The panel's waiting view: the developer pasted the link from the browser page. Completes the sign-in through
 * the same exchange the vscode:// callback and the "Paste sign-in link" command use. Response value is JSON
 * {ok, message}; the panel shows a refusal inline, under the field.
 */
export async function pasteSignInLink(controller: Controller, request: StringRequest): Promise<ProtoString> {
	const result = await completeFromLink(request.value ?? "")
	await controller.postStateToWebview()
	return ProtoString.create({ value: JSON.stringify(result) })
}
