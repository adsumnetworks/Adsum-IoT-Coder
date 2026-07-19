import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { BRAND_CORAL, BRAND_CYAN_300, BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha } from "../brandColors"

/**
 * The run-target: where do cards execute — here in Adsum, or on the developer's own coding agent?
 *
 * ONE control for a session-level decision (mockup mcp-sdk/11). It replaced four identical per-card
 * "Run with my coding agent" rows, and it ABSORBS the conductor pill: with no model configured the
 * Adsum segment is locked with the honest reason and the agent side is pre-selected — the control now
 * says what the pill used to. The hidden-mode trap is mitigated at the point of action: while agent
 * mode is on, every runnable card shows a small "→ your agent" route chip (rendered by IntentList).
 */
export type RunTarget = "adsum" | "agent"

const formatTokens = (n: number): string => {
	if (n >= 1_000_000) {
		return `${Math.round(n / 100_000) / 10}M`
	}
	if (n >= 1000) {
		return `${Math.round(n / 1000)}K`
	}
	return `${n}`
}

const RunTargetToggle: React.FC<{
	target: RunTarget
	conducting: boolean
	onChange: (t: RunTarget) => void
}> = ({ target, conducting, onChange }) => {
	const { freeTierRemainingTokens, navigateToSettings } = useExtensionState()
	const { isDark } = useVSCodeTheme()
	const cyanText = isDark ? BRAND_CYAN_300 : BRAND_CYAN_700

	const seg = (opts: {
		key: RunTarget
		label: string
		sub: React.ReactNode
		locked?: boolean
		lockedTitle?: string
		/** A locked segment stays a DOOR: clicking it routes to fixing what locks it (add a model). */
		onLockedClick?: () => void
	}) => {
		const on = target === opts.key
		return (
			<button
				key={opts.key}
				onClick={opts.locked ? opts.onLockedClick : () => onChange(opts.key)}
				style={{
					flex: 1,
					textAlign: "center",
					padding: "6px 8px",
					cursor: "pointer",
					border: "none",
					background: on ? brandAlpha(BRAND_CYAN_600, 0.1) : "var(--vscode-input-background)",
					boxShadow: on ? `inset 0 0 0 1.5px ${BRAND_CYAN_600}` : "none",
					opacity: opts.locked ? 0.55 : 1,
				}}
				title={opts.lockedTitle}
				type="button">
				<span
					style={{
						display: "block",
						fontSize: "11.5px",
						fontWeight: 700,
						color: on ? cyanText : "var(--vscode-descriptionForeground)",
					}}>
					{opts.label}
				</span>
				<span
					style={{ display: "block", fontSize: "9.5px", color: "var(--vscode-descriptionForeground)", opacity: 0.85 }}>
					{opts.sub}
				</span>
			</button>
		)
	}

	return (
		<div style={{ marginBottom: "10px" }}>
			<div
				style={{
					display: "flex",
					border: "1px solid var(--vscode-panel-border)",
					borderRadius: "9px",
					overflow: "hidden",
					marginBottom: "6px",
				}}>
				{seg({
					key: "adsum",
					label: "◆ Here in Adsum",
					sub: conducting
						? "needs a model · add one"
						: freeTierRemainingTokens !== undefined
							? `${formatTokens(freeTierRemainingTokens)} free tokens left`
							: "with Adsum's model",
					locked: conducting,
					lockedTitle: conducting
						? "No inference model is configured — add one in Models to run cards here"
						: undefined,
				})}
				{seg({
					key: "agent",
					label: "⇄ My coding agent",
					sub: conducting ? (
						<span style={{ color: BRAND_CORAL }}>Adsum is conducting</span>
					) : (
						"your subscription runs it"
					),
				})}
			</div>
			<div style={{ fontSize: "10.5px", color: "var(--vscode-descriptionForeground)", lineHeight: 1.45 }}>
				{target === "agent"
					? conducting
						? "No model configured, so your coding agent runs the work — Adsum conducts: knowledge, toolchain, tracking, snapshots."
						: "Cards hand to your coding agent — Adsum guides it, tracks every step, keeps snapshots · no Adsum tokens."
					: "Cards run in this panel with Adsum's model."}
			</div>
		</div>
	)
}

export default RunTargetToggle
