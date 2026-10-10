import type React from "react"
import { ADSUM_MARK_PATHS, ADSUM_MARK_TRANSFORM, ADSUM_MARK_VIEWBOX } from "@/assets/adsumMarkPath"
import { BRAND_CORAL } from "../chat/brandColors"

/**
 * [0.5] The product's own mark and name, one component, so every surface draws the same logo: the rail's
 * title row, the empty session tab's wordmark, the composer foot. The mark is the extension icon's path
 * data in currentColor (coral by default); the name is set in type, never an image, so it follows the
 * theme and the font size.
 */
export const AdsumMark: React.FC<{ size?: number; color?: string; title?: string }> = ({
	size = 16,
	color = BRAND_CORAL,
	title,
}) => (
	<svg
		aria-hidden={title ? undefined : true}
		height={size}
		role={title ? "img" : undefined}
		style={{ color, flex: "none", display: "inline-block", verticalAlign: "middle" }}
		viewBox={ADSUM_MARK_VIEWBOX}
		width={size}>
		{title ? <title>{title}</title> : null}
		<g fill="currentColor" stroke="none" transform={ADSUM_MARK_TRANSFORM}>
			{ADSUM_MARK_PATHS.map((d) => (
				<path d={d} key={d.slice(0, 24)} />
			))}
		</g>
	</svg>
)

export const AdsumLogo: React.FC<{ size?: number; name?: string; muted?: boolean }> = ({
	size = 16,
	name = "Adsum IoT Coder",
	muted = false,
}) => (
	<span
		data-testid="adsum-logo"
		style={{
			display: "inline-flex",
			alignItems: "center",
			gap: Math.round(size * 0.45),
			fontSize: Math.round(size * 0.85),
			fontWeight: 600,
			letterSpacing: "-0.01em",
			color: muted ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)",
			whiteSpace: "nowrap",
		}}>
		<AdsumMark size={size} title="Adsum IoT Coder" />
		{name}
	</span>
)

export default AdsumLogo
