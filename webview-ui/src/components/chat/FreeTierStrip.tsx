import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, BRAND_CYAN_300, BRAND_CYAN_600, brandAlpha } from "./brandColors"

/** Compact token label: ≥1M → one decimal (e.g. 1.3M), ≥1K → rounded K, else raw. */
const formatTokens = (n: number): string => {
	if (n >= 1_000_000) {
		return `${Math.round(n / 100_000) / 10}M`
	}
	if (n >= 1000) {
		return `${Math.round(n / 1000)}K`
	}
	return `${n}`
}

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

	const tokensLabel = formatTokens(freeTierRemainingTokens)

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
			<span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
				<i className="codicon codicon-zap" style={{ fontSize: "12px", color: BRAND_CORAL }} />
				<span>
					<strong style={{ color: "var(--vscode-foreground)" }}>Free tier</strong> · AI inference by Adsum Networks ·{" "}
					<strong style={{ color: "var(--vscode-foreground)" }}>{tokensLabel}</strong> tokens left
				</span>
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
