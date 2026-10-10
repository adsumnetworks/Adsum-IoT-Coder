import type React from "react"
import { BRAND_CYAN_TEXT } from "./brandColors"

export interface ImageModelNoticeProps {
	/** True once at least one image sits in the composer and the selected model cannot read it. */
	show: boolean
	onOpenSettings: () => void
}

/**
 * [P5.1 / P7.7 sessions first] The free tier's model (and some others) cannot read an attached image.
 * The paste or drop still lands in the composer — dropping it silently would be the surprising
 * behaviour — this just names why it will not be acted on, with the one fix: a model that reads images.
 */
const ImageModelNotice: React.FC<ImageModelNoticeProps> = ({ show, onOpenSettings }) => {
	if (!show) {
		return null
	}
	return (
		<div
			className="flex items-center gap-1"
			data-testid="image-model-notice"
			style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", padding: "0 3.5px 2px" }}>
			<span>Images need a model that reads them.</span>
			<button
				className="bg-transparent border-0 p-0 cursor-pointer underline"
				data-testid="image-model-notice-link"
				onClick={onOpenSettings}
				style={{ color: BRAND_CYAN_TEXT, font: "inherit" }}
				type="button">
				Change model
			</button>
		</div>
	)
}

export default ImageModelNotice
