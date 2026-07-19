import { StringRequest } from "@shared/proto/cline/common"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { StateServiceClient } from "@/services/grpc-client"
import { BRAND_CORAL, BRAND_CYAN_300, BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha } from "../brandColors"
import { useRunTarget } from "./useRunTarget"

/**
 * Where the work runs — one row, opened on demand (operator ruling: the two-segment toggle made the
 * agent look like a mode rather than what it is, a peer of the inference options).
 *
 * "My coding agent" sits in the SAME list as the free tier and BYOK providers, because from the
 * developer's side they answer one question: what executes this card. The difference is only that one
 * of them runs on their subscription instead of a key — so it belongs beside them, not above them.
 */
const RunTargetPicker: React.FC = () => {
	const { freeTierRemainingTokens, navigateToSettings, handoverUi } = useExtensionState()
	const { target, conducting, setTarget } = useRunTarget()
	const { isDark } = useVSCodeTheme()
	const [open, setOpen] = useState(false)
	const cyanText = isDark ? BRAND_CYAN_300 : BRAND_CYAN_700

	const tokens =
		freeTierRemainingTokens !== undefined
			? freeTierRemainingTokens >= 1_000_000
				? `${Math.round(freeTierRemainingTokens / 100_000) / 10}M`
				: `${Math.round(freeTierRemainingTokens / 1000)}K`
			: undefined
	const adsumLabel = conducting
		? "needs a model — add one"
		: tokens
			? `Adsum free tier · ${tokens} tokens left`
			: (handoverUi?.conductor.reason ?? "your configured model")

	const current =
		target === "agent" ? "My coding agent" : conducting ? "No model configured" : tokens ? `Free tier · ${tokens}` : "Adsum"

	const pick = (t: "adsum" | "agent") => {
		if (t === "adsum" && conducting) {
			navigateToSettings("api-config")
			return
		}
		setTarget(t)
		setOpen(false)
	}

	const row = (opts: { on: boolean; title: string; sub: React.ReactNode; onClick: () => void; muted?: boolean }) => (
		<button
			onClick={opts.onClick}
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: "9px",
				width: "100%",
				textAlign: "left",
				padding: "8px 10px",
				background: opts.on ? brandAlpha(BRAND_CYAN_600, 0.1) : "transparent",
				border: "none",
				borderRadius: "7px",
				cursor: "pointer",
				opacity: opts.muted ? 0.75 : 1,
			}}
			type="button">
			<span style={{ width: "13px", flexShrink: 0, color: opts.on ? cyanText : "var(--vscode-descriptionForeground)" }}>
				{opts.on ? "●" : "○"}
			</span>
			<span style={{ flex: 1, minWidth: 0 }}>
				<span style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--vscode-foreground)" }}>
					{opts.title}
				</span>
				<span
					style={{
						display: "block",
						fontSize: "10.5px",
						color: "var(--vscode-descriptionForeground)",
						lineHeight: 1.4,
					}}>
					{opts.sub}
				</span>
			</span>
		</button>
	)

	return (
		<div style={{ marginBottom: "10px" }}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: "7px",
					width: "100%",
					padding: "6px 10px",
					background: "var(--vscode-input-background)",
					border: "1px solid var(--vscode-panel-border)",
					borderRadius: "8px",
					cursor: "pointer",
					fontSize: "11.5px",
					color: "var(--vscode-descriptionForeground)",
				}}
				title="Where these cards run"
				type="button">
				<span style={{ color: "var(--vscode-descriptionForeground)" }}>Runs on</span>
				<strong style={{ color: target === "agent" ? cyanText : "var(--vscode-foreground)" }}>{current}</strong>
				{conducting && target === "agent" ? (
					<span style={{ color: BRAND_CORAL, fontSize: "10.5px" }}>· Adsum is conducting</span>
				) : null}
				<span style={{ flex: 1 }} />
				<span>{open ? "▾" : "▸"}</span>
			</button>

			{open ? (
				<div
					style={{
						marginTop: "5px",
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: "8px",
						padding: "4px",
						background: "var(--vscode-editor-background)",
						display: "flex",
						flexDirection: "column",
						gap: "2px",
					}}>
					{row({
						on: target === "adsum" && !conducting,
						title: "Here in Adsum",
						sub: adsumLabel,
						muted: conducting,
						onClick: () => pick("adsum"),
					})}
					{row({
						on: target === "agent",
						title: "My coding agent",
						sub: "Claude Code runs the work on your subscription · Adsum guides it, tracks every step, keeps snapshots · no Adsum tokens",
						onClick: () => pick("agent"),
					})}
					<button
						onClick={() => navigateToSettings("api-config")}
						style={{
							textAlign: "left",
							padding: "6px 10px 6px 32px",
							background: "none",
							border: "none",
							cursor: "pointer",
							fontSize: "10.5px",
							color: cyanText,
						}}
						type="button">
						Add or change a provider key (GLM, OpenRouter, Anthropic…) →
					</button>
				</div>
			) : null}
		</div>
	)
}

/** Fire a card handover with its own mission — exported so card surfaces share one call shape. */
export const handOverCard = (payload: Record<string, unknown>) =>
	StateServiceClient.handoverToAgent(StringRequest.create({ value: JSON.stringify(payload) })).catch(() => {})

export default RunTargetPicker
