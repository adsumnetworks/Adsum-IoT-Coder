import { BrowserConnectionInfo } from "@shared/proto/cline/browser"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Get information about the current browser connection
 * @param controller The controller instance
 * @param request The request message
 * @returns The browser connection info
 */
export async function getBrowserConnectionInfo(controller: Controller, _: EmptyRequest): Promise<BrowserConnectionInfo> {
	// Browser support removed for Nordic Embedded MVP
	// Always return disconnected/local state
	return BrowserConnectionInfo.create({
		isConnected: false,
		isRemote: false,
		host: "",
	})
}
