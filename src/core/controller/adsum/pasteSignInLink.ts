import { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { promptAndPasteSignInLink } from "@/hosts/vscode/pasteSignInLinkPrompt"
import type { Controller } from ".."

/**
 * The panel's "Paste sign-in link". The host asks for the link in an input box and completes the sign-in
 * through the same exchange the `vscode://` callback uses. Response value is JSON {ok, message}, or "" when
 * the developer cancelled.
 */
export async function pasteSignInLink(controller: Controller, _request: EmptyRequest): Promise<ProtoString> {
	const result = await promptAndPasteSignInLink()
	await controller.postStateToWebview()
	return ProtoString.create({ value: result ? JSON.stringify(result) : "" })
}
