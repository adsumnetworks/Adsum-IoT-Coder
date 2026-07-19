import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ArrowRightLeftIcon, KeyRoundIcon } from "lucide-react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, brandAlpha } from "./brandColors"
import InviteCodeField from "./InviteCodeField"
import { handOverCard } from "./welcome/RunTargetPicker"

/**
 * Shown when the Adsum free-tier quota is exhausted (HTTP 402). Three ways forward, and the third is
 * the one that costs nothing: a developer with a Claude Code subscription already pays for inference,
 * so Adsum can keep conducting (knowledge, toolchain, tracking, snapshots) on their agent instead of
 * dead-ending them at a paywall. BYOK and the invite code remain for people who want to run here.
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
					Two ways to keep going: add your own API key, or keep working on the coding-agent subscription you already pay
					for — Adsum guides it either way.
				</p>
			</div>

			<VSCodeButton className="w-full" onClick={() => navigateToSettings("api-config")}>
				<KeyRoundIcon className="mr-2" size={14} />
				Add your own API key
			</VSCodeButton>

			{/* The escape hatch that costs nothing: their Claude Code subscription already runs models.
			    Adsum keeps conducting — knowledge, toolchain, tracking, snapshots — on zero Adsum tokens. */}
			<VSCodeButton
				appearance="secondary"
				className="w-full mt-2"
				onClick={() => handOverCard({ intentId: "buildFlashDebug", platform: "both", prompt: "" })}>
				<ArrowRightLeftIcon className="mr-2" size={14} />
				Continue on my coding agent
			</VSCodeButton>
			<p className="m-0 mt-1 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
				Claude Code runs it on your subscription · no Adsum tokens
			</p>

			<InviteCodeField />
		</div>
	)
}

export const QUOTA_EXHAUSTED_MARKER = "adsum:quota_exhausted"

export default QuotaExhaustedCard
