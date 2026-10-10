import type React from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
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

/**
 * The product lockup is the brand artwork, never a typed name: the coral mark, "adsum" in the light geometric
 * face, IOT CODER beneath (assets/branding, shipped as the two theme crops). `size` is the rendered height.
 */
export const AdsumLogo: React.FC<{ size?: number; name?: string; muted?: boolean }> = ({ size = 16, muted = false }) => (
	<span
		data-testid="adsum-logo"
		style={{ display: "inline-flex", alignItems: "center", opacity: muted ? 0.75 : 1, lineHeight: 0 }}>
		<img alt="Adsum IoT Coder" className="adsum-wordmark-dark" src={adsumLogoDark} style={{ height: size, width: "auto" }} />
		<img
			alt=""
			aria-hidden="true"
			className="adsum-wordmark-light"
			src={adsumLogoLight}
			style={{ height: size, width: "auto" }}
		/>
	</span>
)

export default AdsumLogo
