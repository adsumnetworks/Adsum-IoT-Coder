import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { KeyRoundIcon } from "lucide-react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, brandAlpha } from "./brandColors"
import InviteCodeField from "./InviteCodeField"

/**
 * Conversion card shown when the Adsum free-tier quota is exhausted (HTTP 402).
 * Offers two paths: add a BYOK key for unlimited access, or redeem an invite code
 * for extra free-tier tokens.
 */
const QuotaExhaustedCard = () => {
	const { navigateToSettings } = useExtensionState()

	return (
		<div
			className="p-3 rounded-md mb-2"
			style={{
				background: "var(--vscode-textBlockQuote-background)",
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.4)}`,
			}}>
			<div className="mb-3">
				<p className="m-0 mb-1 font-semibold" style={{ color: "var(--vscode-foreground)" }}>
					Free tier quota reached
				</p>
				<p className="m-0 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
					You've used your free session. Add your own API key to keep debugging with unlimited access.
				</p>
			</div>

			<VSCodeButton className="w-full" onClick={() => navigateToSettings("api-config")}>
				<KeyRoundIcon className="mr-2" size={14} />
				Add your own API key
			</VSCodeButton>

			<InviteCodeField />
		</div>
	)
}

export const QUOTA_EXHAUSTED_MARKER = "adsum:quota_exhausted"

export default QuotaExhaustedCard
