import type { CSSProperties } from "react"
import { BRAND_CORAL, BRAND_CYAN_UI, BRAND_WARNING } from "../chat/brandColors"

/** The rail's five type roles (label 10 caps · meta 11 · body 12 · title 13 · headline 14) and its shapes. */
export const R = {
	label: {
		fontSize: 10,
		letterSpacing: ".08em",
		textTransform: "uppercase",
		color: "var(--vscode-descriptionForeground)",
		fontWeight: 600,
	} as CSSProperties,
	meta: { fontSize: 11, color: "var(--vscode-descriptionForeground)", lineHeight: 1.35 } as CSSProperties,
	body: { fontSize: 12, color: "var(--vscode-foreground)", lineHeight: 1.4 } as CSSProperties,
	title: { fontSize: 12.5, fontWeight: 600, color: "var(--vscode-foreground)", lineHeight: 1.3 } as CSSProperties,
	headline: { fontSize: 14, fontWeight: 700, color: "var(--vscode-foreground)" } as CSSProperties,
	kind: {
		fontSize: 9.5,
		letterSpacing: ".06em",
		textTransform: "uppercase",
		color: "var(--vscode-descriptionForeground)",
		marginLeft: 6,
		fontWeight: 500,
	} as CSSProperties,
	pf: {
		fontFamily: "var(--vscode-editor-font-family)",
		fontSize: 9.5,
		border: "1px solid color-mix(in srgb, var(--vscode-foreground) 30%, transparent)",
		borderRadius: 3,
		padding: "0 4px",
		color: "var(--vscode-descriptionForeground)",
		flex: "none",
	} as CSSProperties,
	block: { display: "flex", flexDirection: "column", gap: 5 } as CSSProperties,
	blockHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 } as CSSProperties,
	link: {
		font: "inherit",
		fontSize: 11,
		background: "none",
		border: 0,
		color: "var(--adsum-cyan-text)",
		cursor: "pointer",
		padding: 0,
	} as CSSProperties,
	row: (focal?: boolean, locked?: boolean): CSSProperties => ({
		display: "flex",
		alignItems: "flex-start",
		gap: 8,
		padding: "6px 8px",
		borderRadius: 6,
		border: `1px solid ${focal ? BRAND_CYAN_UI : locked ? "color-mix(in srgb, var(--vscode-foreground) 18%, transparent)" : "transparent"}`,
		background: focal ? `color-mix(in srgb, ${BRAND_CYAN_UI} 8%, transparent)` : "none",
		color: "var(--vscode-foreground)",
		font: "inherit",
		textAlign: "left",
		width: "100%",
		cursor: "pointer",
	}),
	icon: (focal?: boolean, locked?: boolean): CSSProperties => ({
		flex: "none",
		width: 18,
		height: 18,
		borderRadius: "50%",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 10,
		color: locked ? "var(--vscode-descriptionForeground)" : "#fff",
		background: locked
			? "color-mix(in srgb, var(--vscode-foreground) 14%, transparent)"
			: focal
				? "var(--adsum-cyan)"
				: BRAND_CORAL,
		marginTop: 1,
	}),
	pill: (kind: "pri" | "ghost" = "ghost"): CSSProperties => ({
		font: "inherit",
		fontSize: 11,
		padding: "2px 8px",
		borderRadius: 4,
		border: `1px solid ${kind === "pri" ? "var(--adsum-cyan)" : "color-mix(in srgb, var(--vscode-foreground) 30%, transparent)"}`,
		background: kind === "pri" ? "var(--adsum-cyan)" : "none",
		color: kind === "pri" ? "#fff" : "var(--vscode-foreground)",
		fontWeight: kind === "pri" ? 600 : 400,
		cursor: "pointer",
	}),
	warn: BRAND_WARNING,
	coral: BRAND_CORAL,
}

export const KIND_WORD: Record<string, string> = {
	fire: "runs now",
	sample: "sample · runs now",
	prefill: "fills the box",
	locked: "locked",
	"open-folder": "opens a folder",
}

/** What a click does, said once in the hover, not on every row. */
export const KIND_SENTENCE: Record<string, string> = {
	fire: "Click: opens a session tab and sends this straight away.",
	sample: "Click: opens a session tab and runs the sample straight away, about a minute.",
	prefill: "Click: opens a session tab with this written in the box; Enter sends it.",
	locked: "Locked: a registered account, or a request, opens it.",
	"open-folder": "Click: opens a folder picker first.",
}
