import type { HandoverStrip } from "@shared/handover"
import { EmptyRequest } from "@shared/proto/cline/common"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { BRAND_CYAN_600, BRAND_CYAN_700, BRAND_SUCCESS, BRAND_WARNING, brandAlpha } from "../brandColors"

/**
 * The live agent session, as a BANNER — one line above whatever the developer is doing.
 *
 * This exists because the full session view owned the entire panel: with a handover in flight the cards
 * were gone, the sample runs were gone, and there was nothing to click. A session you are WATCHING must
 * never occupy the surface you WORK on. So the default is this strip; the conversation opens on demand.
 *
 * Everything it says is derived from `liveness` — we cannot see the agent's process, so the banner
 * reports call-recency and nothing more.
 */
const AgentSessionBanner: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
	const { handoverUi } = useExtensionState()
	const strip: HandoverStrip | null | undefined = handoverUi?.strip
	if (!strip) {
		return null
	}

	const lv = strip.liveness
	const closed = strip.phase === "closed"
	const mins = Math.round(lv.sinceSec / 60)
	const dot = closed
		? BRAND_SUCCESS
		: lv.state === "working"
			? BRAND_CYAN_600
			: lv.state === "stopped"
				? BRAND_WARNING
				: "var(--vscode-descriptionForeground)"
	const state = closed
		? "finished — ready to bring back"
		: lv.state === "working"
			? `working · ${strip.calls} call${strip.calls === 1 ? "" : "s"}`
			: lv.state === "idle"
				? `idle — last heard ${mins} min ago`
				: lv.state === "never-picked-up"
					? "waiting to be picked up"
					: `stopped responding — last heard ${mins} min ago`
	const queued = strip.queued?.length ?? 0

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "5px 12px",
				fontSize: "11px",
				color: "var(--vscode-descriptionForeground)",
				background: brandAlpha(BRAND_CYAN_600, 0.06),
				borderBottom: `1px solid ${brandAlpha(BRAND_CYAN_600, 0.2)}`,
			}}>
			<span
				style={{
					width: "7px",
					height: "7px",
					borderRadius: "50%",
					background: dot,
					flexShrink: 0,
					animation: lv.state === "working" && !closed ? "adsum-pulse 1.1s infinite" : undefined,
				}}
			/>
			<span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
				<strong style={{ color: "var(--vscode-foreground)" }}>Your coding agent</strong> · {state}
			</span>
			{queued ? (
				<span style={{ color: BRAND_WARNING, whiteSpace: "nowrap", flexShrink: 0 }} title="Not received by the agent yet">
					· {queued} unsent
				</span>
			) : null}
			<span
				style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
				title={strip.mission}>
				· {strip.mission}
			</span>
			<button
				onClick={onOpen}
				style={{
					background: "none",
					border: "none",
					padding: 0,
					cursor: "pointer",
					color: BRAND_CYAN_700,
					fontSize: "11px",
					fontWeight: 600,
					textDecoration: "underline",
					whiteSpace: "nowrap",
					flexShrink: 0,
				}}
				type="button">
				View session
			</button>
			<button
				onClick={() => StateServiceClient.continueHandoverHere(EmptyRequest.create({})).catch(() => {})}
				style={{
					background: "none",
					border: "none",
					padding: 0,
					cursor: "pointer",
					color: "var(--vscode-descriptionForeground)",
					fontSize: "11px",
					textDecoration: "underline",
					whiteSpace: "nowrap",
					flexShrink: 0,
				}}
				title="Bring this session back into Adsum, carrying everything the agent did"
				type="button">
				Continue here
			</button>
			<style>{`@keyframes adsum-pulse{0%,100%{opacity:.25}50%{opacity:1}}`}</style>
		</div>
	)
}

export default AgentSessionBanner
