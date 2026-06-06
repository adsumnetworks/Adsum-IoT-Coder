import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CYAN_300, BRAND_CYAN_600, brandAlpha } from "./brandColors"

/**
 * Persistent strip shown while the user is on the Adsum free tier.
 * Signals (a) it's free, (b) Adsum Networks provides/pays for the inference,
 * (c) how much quota is left, and (d) the BYOK escape hatch — without nagging.
 *
 * Renders nothing when the user is not on the free tier (freeTierRemainingTokens undefined).
 */
const FreeTierStrip = () => {
	const { freeTierRemainingTokens, navigateToSettings } = useExtensionState()

	if (freeTierRemainingTokens === undefined) {
		return null
	}

	const tokensLabel =
		freeTierRemainingTokens >= 1000 ? `${Math.round(freeTierRemainingTokens / 1000)}K` : `${freeTierRemainingTokens}`

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
				padding: "5px 12px",
				fontSize: "11px",
				color: BRAND_CYAN_300,
				background: brandAlpha(BRAND_CYAN_600, 0.08),
				borderBottom: `1px solid ${brandAlpha(BRAND_CYAN_600, 0.22)}`,
			}}>
			<span>
				⚡ <strong style={{ color: "var(--vscode-foreground)" }}>Free tier</strong> · AI inference by Adsum Networks ·{" "}
				<strong style={{ color: "var(--vscode-foreground)" }}>{tokensLabel}</strong> tokens left
			</span>
			<button
				onClick={() => navigateToSettings("api-config")}
				style={{
					background: "none",
					border: "none",
					color: "var(--vscode-descriptionForeground)",
					textDecoration: "underline",
					cursor: "pointer",
					fontSize: "10.5px",
					whiteSpace: "nowrap",
					padding: 0,
				}}
				title="When the free tier runs out, add your own provider key to keep going"
				type="button">
				Add key
			</button>
		</div>
	)
}

export default FreeTierStrip
