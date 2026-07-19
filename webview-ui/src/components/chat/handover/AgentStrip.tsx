import type { HandoverStrip } from "@shared/handover"
import { EmptyRequest } from "@shared/proto/cline/common"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { StateServiceClient } from "@/services/grpc-client"
import { BRAND_CORAL, BRAND_CYAN_300, BRAND_CYAN_600, BRAND_CYAN_700, BRAND_SUCCESS, brandAlpha } from "../brandColors"
import MilestoneList from "./MilestoneList"

/**
 * The agent strip — one component, four states, living inside the session view.
 *
 * When a session is handed to the developer's own coding agent, THIS is the only place the developer
 * needs to look: where it is in the journey, what it has done, what Adsum measured, and the way back.
 * It replaces nothing and opens nothing — the session stays the workbench.
 *
 * Vocabulary rule: the developer never sees "handover", "MCP", "brief" or "ledger". The concept is
 * "your coding agent". The one exception is the pickup sentence, which is addressed to the agent.
 */

const PHASES: { key: HandoverStrip["phase"]; label: string }[] = [
	{ key: "posted", label: "Posted" },
	{ key: "pickedUp", label: "Picked up" },
	{ key: "working", label: "Working" },
	{ key: "closed", label: "Closed" },
]

/** Grey = waiting · cyan = live · green = closed. Status only — never a verdict on the agent's work. */
const LED: Record<HandoverStrip["phase"], string> = {
	posted: "var(--vscode-descriptionForeground)",
	pickedUp: "var(--vscode-descriptionForeground)",
	working: BRAND_CYAN_600,
	closed: BRAND_SUCCESS,
}

const elapsed = (from: string, to?: string): string => {
	const a = Date.parse(from)
	const b = to ? Date.parse(to) : Date.now()
	if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
		return ""
	}
	const min = Math.round((b - a) / 60000)
	return min < 1 ? "just now" : min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`
}

const Stepper: React.FC<{ phase: HandoverStrip["phase"] }> = ({ phase }) => {
	const now = PHASES.findIndex((p) => p.key === phase)
	return (
		<div style={{ display: "flex", padding: "9px 12px 2px", fontSize: "10.5px" }}>
			{PHASES.map((p, i) => {
				const past = i < now
				const on = i === now
				return (
					<div
						key={p.key}
						style={{
							flex: 1,
							textAlign: "center",
							position: "relative",
							paddingTop: "13px",
							color: on
								? "var(--vscode-foreground)"
								: past
									? "var(--vscode-descriptionForeground)"
									: "var(--vscode-disabledForeground)",
							fontWeight: on ? 700 : 400,
						}}>
						{i > 0 ? (
							<span
								style={{
									position: "absolute",
									top: "8px",
									left: "calc(-50% + 6px)",
									width: "calc(100% - 12px)",
									height: "1.5px",
									background: "var(--vscode-panel-border)",
								}}
							/>
						) : null}
						<span
							style={{
								position: "absolute",
								top: "3px",
								left: "50%",
								transform: "translateX(-50%)",
								width: "9px",
								height: "9px",
								borderRadius: "50%",
								background: past ? BRAND_SUCCESS : on ? BRAND_CYAN_600 : "var(--vscode-editor-background)",
								border: `1.5px solid ${past ? BRAND_SUCCESS : on ? BRAND_CYAN_600 : "var(--vscode-panel-border)"}`,
							}}
						/>
						{p.label}
					</div>
				)
			})}
		</div>
	)
}

const AgentStrip: React.FC = () => {
	const { handoverUi } = useExtensionState()
	const { isDark } = useVSCodeTheme()
	const strip = handoverUi?.strip
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

	const copyPickup = () => {
		navigator.clipboard?.writeText(strip.pickupPrompt).then(
			() => setCopied(true),
			() => {},
		)
	}
	const continueHere = () => StateServiceClient.continueHandoverHere(EmptyRequest.create({})).catch(() => {})
	const viewWorklog = () => StateServiceClient.showHandoverWorklog(EmptyRequest.create({})).catch(() => {})

	// Light cyan reads on dark panels but washes out on a light theme; fall to the on-fill-safe cyan.
	const labelCyan = isDark ? BRAND_CYAN_300 : BRAND_CYAN_700
	const closed = strip.phase === "closed"
	const sub = closed
		? `closed cleanly · ${strip.calls} call${strip.calls === 1 ? "" : "s"} · ${elapsed(strip.startedAt, strip.closedAt)}`
		: strip.phase === "posted"
			? strip.mission
			: `working · ${strip.calls} call${strip.calls === 1 ? "" : "s"}`

	return (
		<div
			style={{
				margin: "10px 12px 4px",
				border: "1px solid var(--vscode-panel-border)",
				borderRadius: "10px",
				overflow: "hidden",
				background: "var(--vscode-editor-background)",
			}}>
			{/* header: who / where / the way back */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "9px",
					padding: "8px 12px",
					background: brandAlpha(BRAND_CYAN_600, 0.06),
					borderBottom: "1px solid var(--vscode-panel-border)",
				}}>
				<span
					style={{
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						flexShrink: 0,
						background: LED[strip.phase],
						animation: strip.phase === "working" ? "adsum-pulse 1.1s infinite" : undefined,
					}}
				/>
				<span style={{ fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>Your coding agent</span>
				{/* the mission is the ONLY flexible element: it truncates, everything else keeps its size */}
				<span
					style={{
						flex: 1,
						minWidth: 0,
						fontSize: "11px",
						color: "var(--vscode-descriptionForeground)",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
					title={sub}>
					· {sub}
				</span>
				<button
					onClick={continueHere}
					style={{
						border: closed ? "none" : "1px solid var(--vscode-panel-border)",
						borderRadius: "7px",
						padding: "4px 12px",
						fontWeight: 700,
						fontSize: "11.5px",
						cursor: "pointer",
						whiteSpace: "nowrap",
						// Filled cyan follows the house convention (UpgradeCard/CraNudge): the on-fill token
						// with white text. Secondary uses VS Code's own secondary-button tokens rather than a
						// badge fill — badge backgrounds are saturated accents in many themes.
						background: closed ? BRAND_CYAN_700 : "var(--vscode-button-secondaryBackground)",
						color: closed ? "#fff" : "var(--vscode-button-secondaryForeground)",
					}}
					title="Bring this session back into Adsum, carrying everything the agent did"
					type="button">
					{closed ? "Continue here" : "Continue here instead"}
				</button>
			</div>

			<Stepper phase={strip.phase} />

			<div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: "9px" }}>
				{/* posted: how to pick it up */}
				{strip.phase === "posted" ? (
					<>
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
							<span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
					</>
				) : null}

				{/* what was packed for it (posted + picked up) */}
				{strip.phase === "posted" || strip.phase === "pickedUp" ? (
					<div style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "12px" }}>
						{strip.baseline.created ? (
							<div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
								<span
									style={{ width: "15px", textAlign: "center", color: "var(--vscode-descriptionForeground)" }}>
									⎘
								</span>
								<span style={{ color: "var(--vscode-descriptionForeground)" }}>
									safety snapshot created — every milestone will be snapshotted
								</span>
							</div>
						) : null}
						{strip.packed.bits ? (
							<div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
								<span style={{ width: "15px", textAlign: "center", color: BRAND_CORAL }}>◆</span>
								<span style={{ color: "var(--vscode-descriptionForeground)" }}>
									{strip.packed.bits} knowledge bits packed
									{strip.packed.governing ? (
										<>
											{" · guided by "}
											<strong style={{ color: "var(--vscode-foreground)" }}>
												{strip.packed.governing.title}
											</strong>
											{" by "}
											<span style={{ color: BRAND_CORAL }}>{strip.packed.governing.author}</span>
										</>
									) : null}
								</span>
							</div>
						) : null}
					</div>
				) : null}

				{/* working: the milestone worklog */}
				{strip.phase === "working" || strip.phase === "pickedUp" ? (
					<MilestoneList onViewAll={viewWorklog} rows={strip.milestones} truncated={strip.truncated} />
				) : null}

				{/* live pulse — only while genuinely recent */}
				{strip.live ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
							padding: "6px 10px",
							fontFamily: "var(--vscode-editor-font-family)",
							fontSize: "11px",
							color: "var(--vscode-descriptionForeground)",
							border: "1px solid var(--vscode-panel-border)",
							borderRadius: "8px",
						}}>
						<span
							style={{
								width: "7px",
								height: "7px",
								borderRadius: "50%",
								background: BRAND_CYAN_600,
								animation: "adsum-pulse 1.1s infinite",
							}}
						/>
						<span>{strip.live.verb}</span>
						<span style={{ marginLeft: "auto" }}>{strip.live.sinceSec}s</span>
					</div>
				) : null}

				{/* closed: the receipt — what it says vs what we measured */}
				{closed && strip.closing ? (
					<div
						style={{
							border: "1px solid var(--vscode-panel-border)",
							borderRadius: "9px",
							background: "var(--vscode-textCodeBlock-background)",
							padding: "10px 12px",
							fontSize: "12px",
							display: "flex",
							flexDirection: "column",
							gap: "6px",
						}}>
						<div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "7px" }}>
							<span style={{ color: BRAND_SUCCESS }}>✓</span>
							{strip.closing.headline}
						</div>
						<Receipt label="It says" labelColor={labelCyan}>
							{strip.closing.itSays.files.length
								? `Touched ${strip.closing.itSays.files.join(", ")}`
								: "Reported no file changes"}
						</Receipt>
						<Receipt label="Adsum saw" labelColor={labelCyan}>
							{strip.closing.adsumSaw.diffstat ? (
								<strong style={{ color: "var(--vscode-foreground)" }}>{strip.closing.adsumSaw.diffstat}</strong>
							) : (
								<span>no working-tree change measured</span>
							)}
							{` · ${strip.closing.adsumSaw.snapshots} snapshot${strip.closing.adsumSaw.snapshots === 1 ? "" : "s"} kept`}
							{strip.closing.adsumSaw.buildsGreen ? " · builds green" : ""}
						</Receipt>
						{strip.closing.itSays.nextStep ? (
							<Receipt label="Next step" labelColor={labelCyan}>
								{strip.closing.itSays.nextStep}
							</Receipt>
						) : null}
						{strip.closing.standingOn.authors.length ? (
							<Receipt label="Standing on" labelColor={labelCyan}>
								<span style={{ color: BRAND_CORAL }}>◆</span>{" "}
								{`${strip.closing.standingOn.bits} bit${strip.closing.standingOn.bits === 1 ? "" : "s"} by `}
								<span style={{ color: BRAND_CORAL }}>{strip.closing.standingOn.authors.join(", ")}</span>
								{strip.closing.standingOn.steward ? ` · steward ${strip.closing.standingOn.steward}` : ""}
							</Receipt>
						) : null}
					</div>
				) : null}
			</div>
			<style>{`@keyframes adsum-pulse{0%,100%{opacity:.25}50%{opacity:1}}`}</style>
		</div>
	)
}

const Receipt: React.FC<{ label: string; labelColor: string; children: React.ReactNode }> = ({ label, labelColor, children }) => (
	<div style={{ display: "flex", gap: "8px", fontSize: "11.5px", color: "var(--vscode-descriptionForeground)" }}>
		<span
			style={{
				flexShrink: 0,
				width: "78px",
				textTransform: "uppercase",
				fontSize: "9px",
				letterSpacing: "0.5px",
				fontWeight: 700,
				paddingTop: "2px",
				color: labelColor,
			}}>
			{label}
		</span>
		<span style={{ flex: 1, lineHeight: 1.5 }}>{children}</span>
	</div>
)

export default AgentStrip
