import type React from "react"
import { useId, useState } from "react"

/**
 * [0.5 simple] The one place detail lives: a small ⓘ that shows its text on hover and on keyboard focus,
 * so a row stays one line and the explanation is a glance away. Pure CSS positioning, no portal; the
 * tooltip is a real element with role="tooltip" (a screen reader reads it through aria-describedby),
 * never a native `title`, which VS Code webviews show late or not at all. It is a focusable glyph, not a
 * button: a rung with one action keeps one button.
 */
export const Info: React.FC<{ text: string; label?: string; side?: "below" | "above" }> = ({
	text,
	label = "Details",
	side = "below",
}) => {
	const id = useId()
	const [show, setShow] = useState(false)
	return (
		<span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
			<span
				aria-describedby={show ? id : undefined}
				aria-label={label}
				onBlur={() => setShow(false)}
				onClick={(e) => {
					e.stopPropagation()
					setShow((v) => !v)
				}}
				onFocus={() => setShow(true)}
				onKeyDown={(e) => {
					if (e.key === "Escape") setShow(false)
				}}
				onMouseEnter={() => setShow(true)}
				onMouseLeave={() => setShow(false)}
				role="img"
				style={{
					width: 14,
					height: 14,
					borderRadius: "50%",
					border: "1px solid color-mix(in srgb, var(--vscode-foreground) 35%, transparent)",
					background: "none",
					color: "var(--vscode-descriptionForeground)",
					fontSize: 9,
					lineHeight: "12px",
					padding: 0,
					cursor: "help",
					flex: "none",
					fontFamily: "var(--vscode-font-family)",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					boxSizing: "border-box",
				}}
				tabIndex={0}>
				i
			</span>
			{show && (
				<span
					id={id}
					role="tooltip"
					style={{
						position: "absolute",
						[side === "below" ? "top" : "bottom"]: 18,
						right: 0,
						zIndex: 50,
						width: 220,
						padding: "6px 8px",
						borderRadius: 6,
						fontSize: 11,
						lineHeight: 1.4,
						color: "var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground))",
						background: "var(--vscode-editorHoverWidget-background, var(--vscode-editor-background))",
						border: "1px solid var(--vscode-editorHoverWidget-border, color-mix(in srgb, var(--vscode-foreground) 25%, transparent))",
						boxShadow: "0 2px 8px rgba(0,0,0,.35)",
						whiteSpace: "normal",
						textAlign: "left",
						fontWeight: 400,
					}}>
					{text}
				</span>
			)}
		</span>
	)
}

export default Info
