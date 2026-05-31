import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface AdsumFreeProviderProps {
	currentMode: Mode
	isPopup?: boolean
}

/**
 * Settings panel for the Adsum Free Tier provider.
 * Intentionally minimal — no API key, no model selector. The model and
 * quota are controlled server-side; the user just needs to know they're
 * on the free tier and how to upgrade.
 */
export const AdsumFreeProvider = ({ currentMode: _currentMode, isPopup: _isPopup }: AdsumFreeProviderProps) => {
	const { freeTierRemainingTokens } = useExtensionState()

	return (
		<div
			className="p-3 rounded-md"
			style={{ background: "var(--vscode-textBlockQuote-background)", border: "1px solid rgba(215, 105, 71, 0.4)" }}>
			<div className="flex items-center justify-between mb-1">
				<p className="m-0 font-semibold" style={{ color: "var(--vscode-foreground)" }}>
					You're on the Adsum free tier
				</p>
				{freeTierRemainingTokens !== undefined && (
					<span
						className="text-xs px-2 py-0.5 rounded-full"
						style={{
							background: "var(--vscode-badge-background)",
							color: "var(--vscode-badge-foreground)",
						}}>
						{freeTierRemainingTokens.toLocaleString()} tokens left
					</span>
				)}
			</div>
			<p className="m-0 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
				No API key required — inference is provided by Adsum. When your free usage runs out, you can add your own API key
				(any provider) for unlimited access.
			</p>
		</div>
	)
}
