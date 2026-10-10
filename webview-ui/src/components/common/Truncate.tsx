import type React from "react"
import { type CSSProperties, useId, useRef, useState } from "react"

/**
 * [0.5 simple] One line, cut with an ellipsis, and the whole text on hover or focus when (and only when)
 * it was cut. The tooltip is a real element (role="tooltip", linked by aria-describedby), the same look
 * as the Info glyph's, so a long session or run title is never lost to the sidebar's width.
 */
export const Truncate: React.FC<{ text: string; style?: CSSProperties; as?: "span" | "div"; testId?: string }> = ({
	text,
	style,
	as = "span",
	testId,
}) => {
	const id = useId()
	const ref = useRef<HTMLSpanElement>(null)
	const [show, setShow] = useState(false)
	const reveal = () => {
		const el = ref.current
		if (el && el.scrollWidth > el.clientWidth + 1) {
			setShow(true)
		}
	}
	const Tag = as
	return (
		<Tag style={{ position: "relative", minWidth: 0, flex: "1 1 auto", display: as === "span" ? "block" : undefined }}>
			<span
				aria-describedby={show ? id : undefined}
				data-testid={testId}
				onBlur={() => setShow(false)}
				onFocus={reveal}
				onMouseEnter={reveal}
				onMouseLeave={() => setShow(false)}
				ref={ref}
				style={{
					display: "block",
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
					minWidth: 0,
					...style,
				}}>
				{text}
			</span>
			{show && (
				<span
					id={id}
					role="tooltip"
					style={{
						position: "absolute",
						top: "100%",
						left: 0,
						zIndex: 50,
						maxWidth: 280,
						padding: "6px 8px",
						borderRadius: 6,
						fontSize: 11,
						lineHeight: 1.4,
						fontWeight: 400,
						color: "var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground))",
						background: "var(--vscode-editorHoverWidget-background, var(--vscode-editor-background))",
						border: "1px solid var(--vscode-editorHoverWidget-border, color-mix(in srgb, var(--vscode-foreground) 25%, transparent))",
						boxShadow: "0 2px 8px rgba(0,0,0,.35)",
						whiteSpace: "normal",
						textAlign: "left",
					}}>
					{text}
				</span>
			)}
		</Tag>
	)
}

export default Truncate
