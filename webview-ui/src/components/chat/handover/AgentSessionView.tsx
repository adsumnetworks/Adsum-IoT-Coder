import type { HandoverStrip, MilestoneRow } from "@shared/handover"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { StateServiceClient } from "@/services/grpc-client"
import {
	BRAND_CORAL,
	BRAND_CYAN_300,
	BRAND_CYAN_600,
	BRAND_CYAN_700,
	BRAND_SUCCESS,
	BRAND_WARNING,
	brandAlpha,
} from "../brandColors"
import { buildTurns, type Turn } from "./turns"

/**
 * A handed-over session rendered AS A SESSION (mockup mcp-sdk/12) — a conversation in the chat view,
 * using the idioms every local run already taught the developer: bubbles, a collapsed worklog line
 * with the evidence one click deep, one credit line per turn, a live row, the composer.
 *
 * Three speakers: the developer (mission + typed messages), the agent (◇ — one turn per milestone it
 * reported), and Adsum (◆ — only when it DID something: posted, closed). The two-witness law holds
 * inside the evidence: host-observed rows keep the "seen by Adsum" tag; agent claims never get it.
 *
 * Vocabulary rule unchanged: no "handover/MCP/brief/ledger" — the concept is "your coding agent".
 */

const PHASE_LABEL: Record<HandoverStrip["phase"], string> = {
	posted: "Posted",
	pickedUp: "Picked up",
	working: "Working",
	closed: "Closed",
}
const PHASE_IDX: Record<HandoverStrip["phase"], number> = { posted: 0, pickedUp: 1, working: 2, closed: 3 }

const clock = (iso: string) => {
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// ── evidence: the collapsed worklog under an agent turn ─────────────────────
const Witness = () => (
	<span
		style={{
			fontSize: "8.5px",
			border: "1px solid var(--vscode-panel-border)",
			borderRadius: "6px",
			padding: "0 5px",
			marginLeft: "6px",
			color: "var(--vscode-descriptionForeground)",
			whiteSpace: "nowrap",
		}}
		title="Adsum observed this itself — it does not depend on the agent reporting it">
		seen by Adsum
	</span>
)

const evidenceSummary = (rows: MilestoneRow[]): string => {
	const n = (k: MilestoneRow["kind"]) => rows.filter((r) => r.kind === k).length
	const parts: string[] = []
	const tools = n("tool")
	if (tools) {
		parts.push(`${tools} command${tools === 1 ? "" : "s"}`)
	}
	const hosts = rows.filter((r) => r.kind === "host") as Extract<MilestoneRow, { kind: "host" }>[]
	const files = new Set(hosts.flatMap((h) => h.files)).size
	if (files) {
		parts.push(`${files} file${files === 1 ? "" : "s"} changed`)
	}
	if (n("snap")) {
		parts.push("snapshot taken")
	}
	return parts.join(" · ") || "activity"
}

const EvidenceLog: React.FC<{ rows: MilestoneRow[] }> = ({ rows }) => {
	const [open, setOpen] = useState(false)
	if (!rows.length) {
		return null
	}
	return (
		<div
			style={{
				border: "1px solid var(--vscode-panel-border)",
				borderRadius: "8px",
				background: "var(--vscode-editor-background)",
				fontSize: "11px",
				overflow: "hidden",
				marginTop: "5px",
			}}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					width: "100%",
					padding: "5px 10px",
					background: "none",
					border: "none",
					cursor: "pointer",
					color: "var(--vscode-descriptionForeground)",
					fontFamily: "var(--vscode-editor-font-family)",
					fontSize: "10.5px",
					textAlign: "left",
				}}
				type="button">
				<span style={{ color: BRAND_CYAN_600 }}>⚙</span>
				<span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
					{evidenceSummary(rows)}
				</span>
				<span>{open ? "▾" : "▸"}</span>
			</button>
			{open ? (
				<div style={{ borderTop: "1px solid var(--vscode-panel-border)", padding: "3px 0" }}>
					{rows.map((row, i) => (
						<div
							key={`${row.t}-${i}`}
							style={{
								padding: "3px 10px 3px 24px",
								fontFamily: "var(--vscode-editor-font-family)",
								fontSize: "10.5px",
								color: "var(--vscode-descriptionForeground)",
								position: "relative",
							}}>
							<span
								style={{
									position: "absolute",
									left: "10px",
									color: row.kind === "tool" ? BRAND_SUCCESS : "var(--vscode-descriptionForeground)",
								}}>
								{row.kind === "tool" ? (row.exit === 0 ? "✓" : "✗") : row.kind === "snap" ? "⎘" : "⇢"}
							</span>
							{row.kind === "tool" ? (
								<>
									{row.command} → exit {row.exit}
									<Witness />
								</>
							) : row.kind === "host" ? (
								<>
									{row.files.slice(0, 4).join(", ")}
									{row.files.length > 4 ? ", …" : ""}
									<Witness />
								</>
							) : row.kind === "snap" ? (
								"snapshot taken at milestone"
							) : null}
						</div>
					))}
				</div>
			) : null}
		</div>
	)
}

// ── one conversation turn ───────────────────────────────────────────────────
const Avatar: React.FC<{ who: "you" | "agent" | "adsum" }> = ({ who }) => {
	const style: React.CSSProperties = {
		width: "16px",
		height: "16px",
		borderRadius: "4px",
		display: "grid",
		placeItems: "center",
		fontSize: "9px",
		fontWeight: 800,
		flexShrink: 0,
	}
	if (who === "you") {
		return (
			<span
				style={{
					...style,
					background: brandAlpha(BRAND_CYAN_600, 0.15),
					color: BRAND_CYAN_600,
					border: `1px solid ${brandAlpha(BRAND_CYAN_600, 0.4)}`,
				}}>
				YOU
			</span>
		)
	}
	if (who === "agent") {
		// a third party: neither our identity (coral) nor the action (cyan) — neutral, the ◇ glyph distinguishes
		return (
			<span
				style={{
					...style,
					background: "color-mix(in srgb, var(--vscode-foreground) 10%, transparent)",
					color: "var(--vscode-descriptionForeground)",
					border: "1px solid var(--vscode-panel-border)",
				}}>
				◇
			</span>
		)
	}
	return <span style={{ ...style, background: BRAND_CORAL, color: "#fff" }}>◆</span>
}

const TurnView: React.FC<{ turn: Turn }> = ({ turn }) => {
	const whoLabel =
		turn.speaker === "you"
			? `you${"queued" in turn && turn.queued ? " · queued — delivers at the agent's next milestone" : ""}`
			: turn.speaker === "adsum"
				? "adsum"
				: "inProgress" in turn
					? "your agent · working"
					: `your agent${turn.step ? ` · ${turn.step}` : ""}`
	return (
		<div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "6px",
					fontSize: "10px",
					color: "var(--vscode-descriptionForeground)",
					fontWeight: 700,
					marginBottom: "3px",
				}}>
				<Avatar who={turn.speaker} />
				<span>{whoLabel}</span>
				<span style={{ fontWeight: 400, opacity: 0.7 }}>{clock(turn.at)}</span>
			</div>
			{"text" in turn && turn.text ? (
				<div
					style={{
						fontSize: "12.5px",
						lineHeight: 1.55,
						color: turn.speaker === "adsum" ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)",
						opacity: "queued" in turn && turn.queued ? 0.75 : 1,
					}}>
					{turn.text}
				</div>
			) : null}
			{turn.speaker === "agent" ? (
				<>
					<EvidenceLog rows={turn.evidence} />
					{turn.credits.map((c) => (
						<div
							key={c.title}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "6px",
								fontSize: "11px",
								color: "var(--vscode-descriptionForeground)",
								marginTop: "5px",
							}}>
							<span
								style={{
									width: "15px",
									height: "15px",
									borderRadius: "4px",
									background: brandAlpha(BRAND_CORAL, 0.14),
									color: BRAND_CORAL,
									display: "grid",
									placeItems: "center",
									fontSize: "8.5px",
								}}>
								◆
							</span>
							<span>
								following <strong style={{ color: "var(--vscode-foreground)" }}>{c.title}</strong>
								{c.version ? ` v${c.version}` : ""} by <span style={{ color: BRAND_CORAL }}>{c.author}</span>
							</span>
						</div>
					))}
					{!("inProgress" in turn) &&
						turn.nudges.map((n) => (
							<div
								key={n}
								style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginTop: "4px" }}>
								<strong style={{ color: BRAND_WARNING, fontWeight: 600 }}>◇ nudged</strong> —{" "}
								{n.replace(/^nudged:\s*/, "")}
							</div>
						))}
				</>
			) : null}
		</div>
	)
}

// ── the session view ────────────────────────────────────────────────────────
const AgentSessionView: React.FC = () => {
	const { handoverUi } = useExtensionState()
	const { isDark } = useVSCodeTheme()
	const strip = handoverUi?.strip
	const [draft, setDraft] = useState("")
	const [copied, setCopied] = useState(false)
	useEffect(() => {
		if (!copied) {
			return
		}
		const t = setTimeout(() => setCopied(false), 2000)
		return () => clearTimeout(t)
	}, [copied])

	if (!strip) {
		return null
	}
	const labelCyan = isDark ? BRAND_CYAN_300 : BRAND_CYAN_700
	const closed = strip.phase === "closed"
	const turns = buildTurns(strip)

	const continueHere = () => StateServiceClient.continueHandoverHere(EmptyRequest.create({})).catch(() => {})
	const send = () => {
		const text = draft.trim()
		if (!text) {
			return
		}
		if (closed) {
			continueHere()
			return
		}
		setDraft("")
		StateServiceClient.messageHandoverAgent(StringRequest.create({ value: text })).catch(() => {})
	}
	const copyPickup = () =>
		navigator.clipboard?.writeText(strip.pickupPrompt).then(
			() => setCopied(true),
			() => {},
		)

	return (
		<div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
			{/* compact task header — one line, the mission is the only thing that truncates */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					padding: "7px 11px",
					background: "var(--vscode-sideBar-background)",
					borderBottom: "1px solid var(--vscode-panel-border)",
					fontSize: "11.5px",
				}}>
				<span
					style={{
						width: "7px",
						height: "7px",
						borderRadius: "50%",
						flexShrink: 0,
						background: closed
							? BRAND_SUCCESS
							: strip.phase === "working"
								? BRAND_CYAN_600
								: "var(--vscode-descriptionForeground)",
						animation: strip.phase === "working" ? "adsum-pulse 1.1s infinite" : undefined,
					}}
				/>
				<strong style={{ whiteSpace: "nowrap", flexShrink: 0 }}>Your coding agent</strong>
				<span
					style={{
						flex: 1,
						minWidth: 0,
						color: "var(--vscode-descriptionForeground)",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						fontSize: "11px",
					}}
					title={strip.mission}>
					· {strip.mission}
				</span>
				<span
					style={{
						color: "var(--vscode-descriptionForeground)",
						fontSize: "10px",
						whiteSpace: "nowrap",
						flexShrink: 0,
					}}
					title={`${PHASE_LABEL[strip.phase]} · ${strip.calls} call${strip.calls === 1 ? "" : "s"}`}>
					{Array.from({ length: 4 }, (_, i) => (i <= PHASE_IDX[strip.phase] ? "●" : "○")).join("")}{" "}
					{PHASE_LABEL[strip.phase]}
				</span>
				<button
					onClick={continueHere}
					style={{
						border: closed ? "none" : "1px solid var(--vscode-panel-border)",
						borderRadius: "6px",
						padding: "3px 10px",
						fontSize: "10.5px",
						fontWeight: 700,
						cursor: "pointer",
						whiteSpace: "nowrap",
						flexShrink: 0,
						background: closed ? BRAND_CYAN_700 : "var(--vscode-button-secondaryBackground)",
						color: closed ? "#fff" : "var(--vscode-button-secondaryForeground)",
					}}
					title="Bring this session back into Adsum, carrying everything the agent did"
					type="button">
					Continue here
				</button>
			</div>

			{/* the conversation */}
			<div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
				{turns.map((turn, i) => (
					<TurnView key={`${turn.at}-${turn.speaker}-${i}`} turn={turn} />
				))}

				{/* posted: the pickup instructions are Adsum's ask, right in the conversation */}
				{strip.phase === "posted" ? (
					<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
						<div
							style={{
								display: "flex",
								gap: "8px",
								alignItems: "center",
								background: "var(--vscode-textCodeBlock-background)",
								border: "1px solid var(--vscode-panel-border)",
								borderRadius: "9px",
								padding: "8px 11px",
								fontFamily: "var(--vscode-editor-font-family)",
								fontSize: "11px",
							}}>
							<span
								style={{
									flex: 1,
									minWidth: 0,
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
								}}>
								{strip.pickupPrompt}
							</span>
							<button
								onClick={copyPickup}
								style={{
									background: BRAND_CYAN_700,
									color: "#fff",
									border: "none",
									borderRadius: "6px",
									padding: "3px 10px",
									fontWeight: 700,
									fontSize: "11px",
									cursor: "pointer",
									flexShrink: 0,
								}}
								type="button">
								{copied ? "Copied ✓" : "Copy"}
							</button>
						</div>
						<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", lineHeight: 1.5 }}>
							…paste it into your agent — or just tell it:{" "}
							<strong style={{ color: "var(--vscode-foreground)" }}>"check the Adsum inbox."</strong> A brand-new
							agent window needs one restart to see Adsum.
						</div>
					</div>
				) : null}

				{/* live row — only while genuinely recent */}
				{strip.live ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "7px",
							padding: "5px 9px",
							fontFamily: "var(--vscode-editor-font-family)",
							fontSize: "10.5px",
							color: "var(--vscode-descriptionForeground)",
							border: "1px solid var(--vscode-panel-border)",
							borderRadius: "8px",
						}}>
						<span
							style={{
								width: "6px",
								height: "6px",
								borderRadius: "50%",
								background: BRAND_CYAN_600,
								animation: "adsum-pulse 1.1s infinite",
							}}
						/>
						<span>{strip.live.verb}</span>
						<span style={{ marginLeft: "auto" }}>{strip.live.sinceSec}s</span>
					</div>
				) : null}

				{/* closed: the receipt as the final agent turn */}
				{closed && strip.closing ? (
					<div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "6px",
								fontSize: "10px",
								color: "var(--vscode-descriptionForeground)",
								fontWeight: 700,
								marginBottom: "3px",
							}}>
							<Avatar who="agent" />
							<span>your agent · closing</span>
						</div>
						<div style={{ fontSize: "12.5px", lineHeight: 1.55 }}>
							{strip.closing.headline}
							{strip.closing.itSays.nextStep ? (
								<div style={{ color: "var(--vscode-descriptionForeground)" }}>
									Next: {strip.closing.itSays.nextStep}
								</div>
							) : null}
						</div>
						<div
							style={{
								border: "1px solid var(--vscode-panel-border)",
								borderRadius: "8px",
								background: "var(--vscode-editor-background)",
								fontSize: "10.5px",
								marginTop: "5px",
								padding: "5px 10px",
								fontFamily: "var(--vscode-editor-font-family)",
								color: "var(--vscode-descriptionForeground)",
								display: "flex",
								flexDirection: "column",
								gap: "3px",
							}}>
							<span>
								<span style={{ color: labelCyan, fontWeight: 700 }}>it says</span>{" "}
								{strip.closing.itSays.files.length
									? strip.closing.itSays.files.join(", ")
									: "no file changes reported"}
							</span>
							<span>
								<span style={{ color: labelCyan, fontWeight: 700 }}>measured</span>{" "}
								{strip.closing.adsumSaw.diffstat ?? "no working-tree change measured"}
								<Witness />
							</span>
							<span>
								{strip.closing.adsumSaw.snapshots} snapshot{strip.closing.adsumSaw.snapshots === 1 ? "" : "s"}{" "}
								kept
								{strip.closing.adsumSaw.buildsGreen ? " · builds green" : ""}
								<Witness />
							</span>
						</div>
						{strip.closing.standingOn.authors.length ? (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "6px",
									fontSize: "11px",
									color: "var(--vscode-descriptionForeground)",
									marginTop: "5px",
								}}>
								<span style={{ color: BRAND_CORAL }}>◆</span>
								<span>
									standing on {strip.closing.standingOn.bits} bit
									{strip.closing.standingOn.bits === 1 ? "" : "s"} by{" "}
									<span style={{ color: BRAND_CORAL }}>{strip.closing.standingOn.authors.join(", ")}</span>
									{strip.closing.standingOn.steward ? ` · steward ${strip.closing.standingOn.steward}` : ""}
								</span>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			{/* composer — honest about the transport */}
			<div
				style={{
					borderTop: "1px solid var(--vscode-panel-border)",
					padding: "9px 12px",
					background: "var(--vscode-sideBar-background)",
				}}>
				<div
					style={{
						background: "var(--vscode-input-background)",
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: "9px",
						padding: "6px 10px",
						display: "flex",
						gap: "8px",
						alignItems: "center",
					}}>
					<input
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								send()
							}
						}}
						placeholder={
							closed ? "Continue this session in Adsum…" : "Message your agent — lands at its next milestone…"
						}
						readOnly={closed}
						style={{
							flex: 1,
							background: "none",
							border: "none",
							outline: "none",
							color: "var(--vscode-input-foreground)",
							fontSize: "11.5px",
						}}
						value={draft}
					/>
					<button
						onClick={send}
						style={{
							background: BRAND_CYAN_700,
							color: "#fff",
							border: "none",
							borderRadius: "6px",
							padding: "2px 10px",
							fontWeight: 700,
							fontSize: "11px",
							cursor: "pointer",
						}}
						type="button">
						▶
					</button>
				</div>
			</div>
			<style>{`@keyframes adsum-pulse{0%,100%{opacity:.25}50%{opacity:1}}`}</style>
		</div>
	)
}

export default AgentSessionView
