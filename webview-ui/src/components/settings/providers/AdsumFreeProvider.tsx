import { Mode } from "@shared/storage/types"
import { BRAND_CORAL, brandAlpha } from "@/components/chat/brandColors"
import InviteCodeField from "@/components/chat/InviteCodeField"
import { Info } from "@/components/common/Info"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface AdsumFreeProviderProps {
	currentMode: Mode
	isPopup?: boolean
}

/**
 * [0.5 simple] Settings panel for the Adsum free tier. One line, not two paragraphs — what it means and
 * when to add a key is an Info away, not standing text. Intentionally minimal otherwise: no API key, no
 * model selector, since the model and quota are controlled server-side.
 */
/** 76,488,063 reads as 76.5M in a sidebar; the exact count is in the hover of the You line. */
const formatTokens = (n: number): string =>
	n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`

export const AdsumFreeProvider = ({ currentMode: _currentMode, isPopup: _isPopup }: AdsumFreeProviderProps) => {
	const { freeTierRemainingTokens } = useExtensionState()

	return (
		<div
			className="p-3 rounded-md"
			style={{
				background: "var(--vscode-textBlockQuote-background)",
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.4)}`,
			}}>
			<div className="flex items-center justify-between gap-2 flex-wrap mb-1">
				<p
					className="m-0 font-semibold flex items-center gap-1.5"
					style={{ color: "var(--vscode-foreground)", minWidth: 0 }}>
					Adsum free tier · no key needed
					<Info text="Adsum chooses the model and how hard it thinks here, at no cost to you. Add your own API key, from any provider, once your free usage runs out or to set those yourself." />
				</p>
				{freeTierRemainingTokens !== undefined && (
					<span
						className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
						style={{
							background: "var(--vscode-badge-background)",
							color: "var(--vscode-badge-foreground)",
						}}>
						{formatTokens(freeTierRemainingTokens)} left
					</span>
				)}
			</div>
			<InviteCodeField />
		</div>
	)
}
