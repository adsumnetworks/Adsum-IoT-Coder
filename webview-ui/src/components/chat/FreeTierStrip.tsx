import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { BRAND_CORAL, BRAND_CYAN_300, BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha } from "./brandColors"

/**
 * Below this, the strip comes back whatever the developer has dismissed.
 *
 * The default free grant is 500,000 tokens (backend `config.stage0Quota`), so 100k is roughly the
 * last session or two — late enough that the strip is not nagging, early enough that "add a key" is
 * still something you can do BEFORE you are blocked rather than after.
 *
 * Note what this rule is NOT keyed on: being signed out. Registering grants entitlement groups, not
 * tokens — only a voucher raises the quota — so "register for more" would have been a false promise.
 */
export const LOW_BALANCE_TOKENS = 100_000

const DISMISSED_KEY = "adsum.freeTierStripDismissed"

/**
 * Whether the full-width strip earns its row.
 *
 * It does three jobs: it discloses who pays for the inference, it reports the balance, and it offers
 * the way out. The disclosure has to land at least once — so the strip shows until it is dismissed.
 * The other two only matter when the balance is low — so it returns then, and dismissal cannot bury
 * it. In between, the chip beside the composer carries the number, where the developer's eye already
 * is while the agent works.
 */
export function freeTierStripVisible(remaining: number | undefined, dismissed: boolean): boolean {
	if (remaining === undefined) {
		return false
	}
	if (remaining <= LOW_BALANCE_TOKENS) {
		return true
	}
	return !dismissed
}

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
	const { isDark } = useVSCodeTheme()
	const [dismissed, setDismissed] = useState(() => {
		try {
			return localStorage.getItem(DISMISSED_KEY) === "1"
		} catch {
			return false
		}
	})

	// Bound to a local so the type narrows with the guard: the rule already returns false for
	// undefined, but TypeScript cannot see through the function call.
	const remaining = freeTierRemainingTokens
	if (remaining === undefined || !freeTierStripVisible(remaining, dismissed)) {
		return null
	}

	const tokensLabel = formatTokens(remaining)
	// Light cyan reads well on dark panels but washes out on a near-white light-theme bg;
	// fall to the darker "text-on-fill safe" cyan in light mode. Dark mode unchanged.
	const cyanText = isDark ? BRAND_CYAN_300 : BRAND_CYAN_700

	return (
		<div
			data-testid="free-tier-strip"
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
				padding: "5px 12px",
				fontSize: "11px",
				color: cyanText,
				background: brandAlpha(BRAND_CYAN_600, 0.08),
				borderBottom: `1px solid ${brandAlpha(BRAND_CYAN_600, 0.22)}`,
			}}>
			<span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
				<i className="codicon codicon-zap" style={{ fontSize: "12px", color: BRAND_CORAL }} />
				<span>
					<strong style={{ color: "var(--vscode-foreground)" }}>Free tier</strong> · inference on Adsum Networks ·{" "}
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
			{/* Dismissible, but only while there is nothing to act on: below LOW_BALANCE_TOKENS the
			    strip returns whatever was dismissed, because then it is not a disclosure any more, it
			    is a warning with an action attached. */}
			{remaining > LOW_BALANCE_TOKENS && (
				<button
					aria-label="Hide the free tier banner"
					className="codicon codicon-close"
					data-testid="free-tier-strip-dismiss"
					onClick={() => {
						try {
							localStorage.setItem(DISMISSED_KEY, "1")
						} catch {
							/* storage blocked — it still goes away for this session */
						}
						setDismissed(true)
					}}
					style={{
						background: "none",
						border: "none",
						padding: 0,
						cursor: "pointer",
						color: "var(--vscode-descriptionForeground)",
						fontSize: "11px",
						opacity: 0.7,
					}}
					title="Hide — the balance stays on the model chip below"
					type="button"
				/>
			)}
		</div>
	)
}

export default FreeTierStrip
