import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { KeyRoundIcon, MailIcon } from "lucide-react"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Conversion card shown when the Adsum free-tier quota is exhausted (HTTP 402).
 * Presents two paths: verify email for more free tokens (Phase 1, placeholder)
 * or add a BYOK provider key and switch to unlimited.
 */
const QuotaExhaustedCard = () => {
	const { navigateToSettings } = useExtensionState()

	return (
		<div
			className="p-3 rounded-md mb-2"
			style={{ background: "var(--vscode-textBlockQuote-background)", border: "1px solid rgba(215, 105, 71, 0.4)" }}>
			<div className="mb-3">
				<p className="m-0 mb-1 font-semibold" style={{ color: "var(--vscode-foreground)" }}>
					Free tier quota reached
				</p>
				<p className="m-0 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
					You've used your free session. Add your own API key to keep debugging with unlimited access.
				</p>
			</div>

			<VSCodeButton className="w-full mb-2" onClick={() => navigateToSettings("api-config")}>
				<KeyRoundIcon className="mr-2" size={14} />
				Add your own API key
			</VSCodeButton>

			<VSCodeButton
				appearance="secondary"
				className="w-full"
				disabled
				title="Coming soon — verify your email to unlock more free usage">
				<MailIcon className="mr-2" size={14} />
				Verify email for more free tokens (coming soon)
			</VSCodeButton>
		</div>
	)
}

export const QUOTA_EXHAUSTED_MARKER = "adsum:quota_exhausted"

export default QuotaExhaustedCard
