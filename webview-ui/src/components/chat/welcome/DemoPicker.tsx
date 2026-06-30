import React from "react"
import { BRAND_CYAN_600, BRAND_CYAN_700, brandSubtle } from "../brandColors"
import { DEMO_SCENARIO_LIST } from "../demoScenarios"

interface DemoPickerProps {
	onStartDemo: (scenarioId: string) => void
	disabled?: boolean
	/** Visual treatment: "hero" = cyan focal card; "rerun" = neutral/compact (demoted, e.g. a project is open). */
	variant?: "hero" | "rerun"
	/**
	 * Whether the user has actually run a sample. Drives ONLY the heading word: "Try **another** sample" iff true,
	 * else "Try it on a sample project". Decoupled from `variant` so a first-time user with a project open (compact, but
	 * no sample run yet) doesn't see "another".
	 */
	hasRunDemo?: boolean
	/**
	 * Scenario ids the user has already run at least once → those runnable rows show **"Re-run ▸"** instead of
	 * "Run ▸", so it's clear they can be run again (not dead like a "soon" row).
	 */
	ranIds?: Set<string>
}

// Neutral surfaces for the demoted "rerun" state — quiet, no brand fill (the samples are no longer the hero).
// Three contour tiers: cyan (NEW/featured) > brighter grey (runnable, not NEW) > dim grey (soon/disabled).
const NEUTRAL_BORDER = "color-mix(in srgb, var(--vscode-foreground) 18%, transparent)" // soon/disabled rows
const NEUTRAL_BORDER_RUNNABLE = "color-mix(in srgb, var(--vscode-foreground) 30%, transparent)" // runnable, not NEW
const NEUTRAL_BORDER_HOVER = "color-mix(in srgb, var(--vscode-foreground) 42%, transparent)"
const NEUTRAL_ICON_BG = "color-mix(in srgb, var(--vscode-foreground) 10%, transparent)"

/**
 * "Try it on a sample project" — the consolidated sample picker. Renders one row per registered demo scenario
 * (BLE bug, CRA readiness, …). Replaces the single-scenario DemoCard once the registry holds ≥2 scenarios.
 *
 * - hero: cyan container, the single first-run focal point (until the user has run any sample once).
 * - rerun: neutral, compact — quiet "Try another sample project" once a sample has been seen.
 *
 * Rows are domain-agnostic: they read title / honestLabel / platform / icon straight off each scenario,
 * so adding a sample to DEMO_SCENARIOS surfaces it here with no change to this component.
 */
const DemoPicker: React.FC<DemoPickerProps> = ({
	onStartDemo,
	disabled = false,
	variant = "hero",
	hasRunDemo = false,
	ranIds,
}) => {
	const isRerun = variant === "rerun"
	const containerBorder = isRerun ? NEUTRAL_BORDER : BRAND_CYAN_600
	const containerBg = isRerun ? "transparent" : brandSubtle(BRAND_CYAN_600, 5)

	return (
		<div
			data-testid="demo-picker"
			style={{
				width: "100%",
				marginBottom: isRerun ? 0 : "16px",
				padding: isRerun ? "12px 14px" : "16px 18px",
				background: containerBg,
				border: `${isRerun ? "1px" : "2px"} solid ${containerBorder}`,
				borderRadius: "10px",
			}}>
			<div
				style={{
					fontSize: isRerun ? "12px" : "15px",
					fontWeight: 700,
					color: "var(--vscode-foreground)",
					marginBottom: isRerun ? "8px" : "3px",
				}}>
				{hasRunDemo ? "Try another sample project" : "Try it on a sample project"}
			</div>
			{!isRerun && (
				<div
					style={{
						fontSize: "11.5px",
						color: "var(--vscode-descriptionForeground)",
						marginBottom: "12px",
					}}>
					Run Adsum on our sample project — a CRA readiness check, a real BLE bug, and more. No project of your own
					needed.
				</div>
			)}

			<div style={{ display: "flex", flexDirection: "column", gap: isRerun ? "6px" : "8px" }}>
				{DEMO_SCENARIO_LIST.map((s) => {
					// A placeholder ("coming soon") row is disabled like the global disabled state, so it can't be
					// clicked into a dead end until its owner wires the real demo path.
					const rowDisabled = disabled || !!s.comingSoon
					// Rule (operator): a NEW + runnable sample card carries the cyan contour (the "New" badge and the
					// contour go together), CONSISTENTLY in every state — the hero/expanded picker AND both reduced
					// views (project-open and no-project). It still reads as the flagship in the hero view because the
					// sibling runnable rows keep grey borders. "soon" roadmap rows stay neutral + dimmed even when New.
					const featured = !!s.isNew && !s.comingSoon
					// Contour tiers: cyan (NEW/featured) → brighter grey (runnable, not NEW) → dim grey (soon/disabled).
					// A runnable-but-not-NEW row (e.g. an already-run BLE NUS) reads as clearly active, just without
					// the NEW cyan contour — never as dim as a "soon" row.
					const restBorder = featured ? BRAND_CYAN_600 : rowDisabled ? NEUTRAL_BORDER : NEUTRAL_BORDER_RUNNABLE
					// Three opacity tiers in the reduced picker: runnable (featured OR not) = 80% (clearly active),
					// "soon" = 50% (dimmed). The hero variant stays full-opacity for runnable rows.
					const rowOpacity = rowDisabled ? 0.5 : isRerun ? 0.8 : 1
					// A runnable row the user already ran reads "Re-run ▸" so it's clearly repeatable, not dead.
					const runLabel = s.comingSoon ? "soon" : ranIds?.has(s.id) ? "Re-run ▸" : "Run ▸"
					return (
						<button
							data-testid={`demo-scenario-${s.id}`}
							disabled={rowDisabled}
							key={s.id}
							onClick={() => {
								if (!rowDisabled) {
									onStartDemo(s.id)
								}
							}}
							onMouseEnter={(e) => {
								if (!rowDisabled) {
									e.currentTarget.style.borderColor = NEUTRAL_BORDER_HOVER
									e.currentTarget.style.background = "var(--vscode-toolbar-hoverBackground)"
								}
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.borderColor = restBorder
								e.currentTarget.style.background = "var(--vscode-input-background)"
							}}
							style={{
								width: "100%",
								display: "flex",
								alignItems: "center",
								gap: "12px",
								padding: isRerun ? "8px 10px" : "10px 12px",
								background: "var(--vscode-input-background)",
								border: `1px solid ${restBorder}`,
								borderRadius: "8px",
								cursor: rowDisabled ? "default" : "pointer",
								opacity: rowOpacity,
								textAlign: "left",
								transition: "background 0.15s, border-color 0.15s",
							}}
							type="button">
							<div
								style={{
									flexShrink: 0,
									width: isRerun ? "26px" : "32px",
									height: isRerun ? "26px" : "32px",
									borderRadius: "50%",
									// Icon brightness tracks RUNNABLE, not NEW: every runnable row gets the bright cyan-filled
									// icon so an already-run sample (e.g. BLE NUS — runnable, "Re-run", but not New) reads as
									// active, not disabled. Only "soon"/disabled rows get the neutral grey icon. The cyan
									// CONTOUR + "New" badge remain the sole featured-exclusive cues.
									background: rowDisabled ? NEUTRAL_ICON_BG : BRAND_CYAN_700,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									color: rowDisabled ? "var(--vscode-descriptionForeground)" : "#fff",
								}}>
								<i className={`codicon codicon-${s.icon}`} style={{ fontSize: isRerun ? "13px" : "15px" }} />
							</div>

							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: isRerun ? "12.5px" : "13.5px",
										fontWeight: 600,
										color: "var(--vscode-foreground)",
										lineHeight: 1.3,
									}}>
									{s.title}
									{s.isNew && (
										<span
											style={{
												marginLeft: "6px",
												fontSize: "8.5px",
												fontWeight: 700,
												letterSpacing: "0.04em",
												textTransform: "uppercase",
												color: BRAND_CYAN_600,
												border: `1px solid ${BRAND_CYAN_600}`,
												borderRadius: "4px",
												padding: "0 4px",
												verticalAlign: "middle",
											}}>
											New
										</span>
									)}
								</div>
								{!isRerun && (
									<div
										style={{
											fontSize: "11px",
											color: "var(--vscode-descriptionForeground)",
											opacity: 0.8,
											marginTop: "2px",
											lineHeight: 1.35,
										}}>
										{/* coming-soon rows show a brief teaser (a dimmed roadmap row needn't carry the full sell);
										    live rows keep the full honestLabel. */}
										{s.comingSoon && s.teaser ? s.teaser : s.honestLabel}
									</div>
								)}
							</div>

							<span
								style={{
									flexShrink: 0,
									fontSize: "9.5px",
									fontWeight: 700,
									letterSpacing: "0.04em",
									color: "var(--vscode-descriptionForeground)",
									border: `1px solid ${NEUTRAL_BORDER}`,
									borderRadius: "4px",
									padding: "1px 5px",
								}}>
								{s.platform === "nrf" ? "nRF" : "ESP"}
							</span>
							{/* A1: consistent right-aligned run affordance (design/mockup). The whole row is the button. */}
							<span
								style={{
									flexShrink: 0,
									fontSize: "10.5px",
									fontWeight: 600,
									color: rowDisabled ? "var(--vscode-descriptionForeground)" : BRAND_CYAN_600,
								}}>
								{runLabel}
							</span>
						</button>
					)
				})}
			</div>
		</div>
	)
}

export default DemoPicker
