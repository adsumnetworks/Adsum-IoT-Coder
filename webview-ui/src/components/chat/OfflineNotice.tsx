import type React from "react"
import { Info } from "@/components/common/Info"
import { BRAND_WARNING } from "./brandColors"

export interface OfflineNoticeProps {
	hostOffline?: boolean
}

/**
 * [0.5 simple] A one-line notice at the top of the session when the host reports the model's API
 * unreachable: just "Offline", with an Info for what still works — that detail matters more than the
 * failure, but it is a sentence, not a standing line every developer re-reads every time they see it.
 */
const OfflineNotice: React.FC<OfflineNoticeProps> = ({ hostOffline }) => {
	if (!hostOffline) {
		return null
	}
	return (
		<div
			className="flex items-center gap-1.5"
			data-testid="offline-notice"
			style={{
				fontSize: 11,
				color: "var(--vscode-foreground)",
				background: `color-mix(in srgb, ${BRAND_WARNING} 12%, var(--vscode-editor-background))`,
				borderBottom: `1px solid color-mix(in srgb, ${BRAND_WARNING} 35%, transparent)`,
				padding: "4px 14px",
			}}>
			<span aria-hidden="true" style={{ color: BRAND_WARNING }}>
				●
			</span>
			<span>Offline</span>
			<Info text="Local tools, the knowledge already loaded and your files still work; the model and the registry do not." />
		</div>
	)
}

export default OfflineNotice
