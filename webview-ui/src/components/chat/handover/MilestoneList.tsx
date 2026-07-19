import type { MilestoneRow } from "@shared/handover"
import { BRAND_CORAL, BRAND_CYAN_600, BRAND_SUCCESS, BRAND_WARNING, brandAlpha } from "../brandColors"

/**
 * The milestone worklog for a handed-over session.
 *
 * THE RULE THIS COMPONENT EXISTS TO HOLD: two witnesses, never merged. A `step` row is what the AGENT
 * SAID; `tool`/`host`/`snap` rows are what ADSUM SAW. Only the latter carry the "seen by Adsum" tag.
 * A reader must be able to tell a claim from an observation at a glance — that distinction is the
 * whole trust model of a session you are not watching directly.
 */

const GLYPH: Record<MilestoneRow["kind"], { mark: string; color: string; witnessed: boolean }> = {
	bit: { mark: "◆", color: BRAND_CORAL, witnessed: false },
	step: { mark: "✓", color: BRAND_SUCCESS, witnessed: false },
	tool: { mark: "⚙", color: BRAND_CYAN_600, witnessed: true },
	host: { mark: "⇢", color: "var(--vscode-descriptionForeground)", witnessed: true },
	snap: { mark: "⎘", color: "var(--vscode-descriptionForeground)", witnessed: false },
	nudge: { mark: "◇", color: BRAND_WARNING, witnessed: false },
}

const clock = (iso: string) => {
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const Witness = () => (
	<span
		style={{
			fontSize: "9px",
			border: "1px solid var(--vscode-panel-border)",
			borderRadius: "7px",
			padding: "0 5px",
			marginLeft: "5px",
			color: "var(--vscode-descriptionForeground)",
			whiteSpace: "nowrap",
		}}
		title="Adsum observed this itself — it does not depend on the agent reporting it">
		seen by Adsum
	</span>
)

const Mono: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<code
		style={{
			fontFamily: "var(--vscode-editor-font-family)",
			fontSize: "0.88em",
			background: "var(--vscode-textCodeBlock-background)",
			padding: "0 5px",
			borderRadius: "4px",
		}}>
		{children}
	</code>
)

const RowBody: React.FC<{ row: MilestoneRow }> = ({ row }) => {
	switch (row.kind) {
		case "bit":
			return (
				<>
					<span style={{ color: "var(--vscode-descriptionForeground)" }}>loaded </span>
					{row.title}
					{row.version ? <span style={{ color: "var(--vscode-descriptionForeground)" }}> v{row.version}</span> : null}
					<span style={{ color: "var(--vscode-descriptionForeground)" }}> — by </span>
					<span style={{ color: BRAND_CORAL }}>{row.author}</span>
				</>
			)
		case "step":
			return (
				<>
					{row.step ? (
						<span
							style={{
								display: "inline-block",
								background: "transparent",
								border: "1px solid var(--vscode-panel-border)",
								borderRadius: "8px",
								padding: "0 6px",
								fontSize: "10px",
								fontFamily: "var(--vscode-editor-font-family)",
								color: "var(--vscode-descriptionForeground)",
								marginRight: "5px",
							}}>
							{row.step}
						</span>
					) : null}
					{row.text}
				</>
			)
		case "tool":
			return (
				<>
					<Mono>{row.command}</Mono>
					<span style={{ color: "var(--vscode-descriptionForeground)" }}>
						{" "}
						→ exit {row.exit}
						{row.exit === 0 ? "" : " (failed)"}
					</span>
					<Witness />
				</>
			)
		case "host":
			return (
				<>
					{row.files.length} file{row.files.length === 1 ? "" : "s"} changed
					{row.files.length ? (
						<span style={{ color: "var(--vscode-descriptionForeground)" }}>
							{" · "}
							{row.files.slice(0, 3).join(", ")}
							{row.files.length > 3 ? ", …" : ""}
						</span>
					) : null}
					<Witness />
				</>
			)
		case "snap":
			return <span style={{ color: "var(--vscode-descriptionForeground)" }}>snapshot taken at milestone</span>
		case "nudge":
			return (
				<span style={{ color: "var(--vscode-descriptionForeground)" }}>
					<strong style={{ color: BRAND_WARNING, fontWeight: 600 }}>nudged:</strong>{" "}
					{row.text.replace(/^nudged:\s*/, "")}
				</span>
			)
	}
}

const MilestoneList: React.FC<{ rows: MilestoneRow[]; truncated: boolean; onViewAll: () => void }> = ({
	rows,
	truncated,
	onViewAll,
}) => {
	if (!rows.length) {
		return null
	}
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					fontSize: "9.5px",
					textTransform: "uppercase",
					letterSpacing: "0.6px",
					fontWeight: 700,
					color: "var(--vscode-descriptionForeground)",
					marginBottom: "5px",
				}}>
				<span>Milestones</span>
				<span style={{ flex: 1 }} />
				{truncated ? (
					<button
						onClick={onViewAll}
						style={{
							background: "none",
							border: "none",
							padding: 0,
							cursor: "pointer",
							color: BRAND_CYAN_600,
							fontSize: "10.5px",
							textTransform: "none",
							letterSpacing: 0,
							fontWeight: 600,
						}}
						type="button">
						full worklog ▸
					</button>
				) : null}
			</div>
			{rows.map((row, i) => {
				const g = GLYPH[row.kind]
				return (
					<div
						key={`${row.t}-${row.kind}-${i}`}
						style={{ display: "flex", gap: "8px", alignItems: "baseline", padding: "3px 0", fontSize: "12px" }}>
						<span style={{ width: "15px", textAlign: "center", flexShrink: 0, fontSize: "11px", color: g.color }}>
							{g.mark}
						</span>
						<span style={{ flex: 1, minWidth: 0, color: "var(--vscode-foreground)", lineHeight: 1.45 }}>
							<RowBody row={row} />
						</span>
						<span
							style={{
								fontSize: "10px",
								color: "var(--vscode-descriptionForeground)",
								fontFamily: "var(--vscode-editor-font-family)",
								flexShrink: 0,
							}}>
							{clock(row.t)}
						</span>
					</div>
				)
			})}
			<div style={{ height: "1px", background: brandAlpha(BRAND_CYAN_600, 0.001) }} />
		</div>
	)
}

export default MilestoneList
