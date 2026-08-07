import { ApiHandler } from "@core/api"

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	// Trust the model's declared context window whenever it's present and sane. This used to get
	// force-clamped to 128_000 for any "deepseek"-id model behind the openai-compatible provider — a
	// leftover from deepseek v2/64K days — which destroyed real 1M-token windows (e.g. DeepSeek V4 Pro)
	// down to 128K. Only fall back when the model info is missing the value entirely.
	const reportedContextWindow = api.getModel().info.contextWindow
	const contextWindow = reportedContextWindow && reportedContextWindow > 0 ? reportedContextWindow : 128_000

	let maxAllowedSize: number
	switch (contextWindow) {
		case 64_000: // deepseek v2-era models
			maxAllowedSize = contextWindow - 27_000
			break
		case 128_000: // most models
			maxAllowedSize = contextWindow - 30_000
			break
		case 200_000: // claude models
			maxAllowedSize = contextWindow - 40_000
			break
		default: {
			// Proportional buffer for everything else, including very large windows (DeepSeek V4 Pro's 1M).
			// A flat 40_000 buffer is fine at 128K-200K but is only a ~4% margin at 1M — far too thin. Scale
			// it to 10% of the window, floored at the same 40_000 the known cases use, so small unlisted
			// windows keep at least that much headroom.
			const buffer = Math.max(40_000, contextWindow * 0.1)
			maxAllowedSize = contextWindow - buffer
		}
	}

	return { contextWindow, maxAllowedSize }
}
