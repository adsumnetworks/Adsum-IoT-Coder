import type React from "react"
import { BRAND_WARNING } from "./brandColors"

export interface OfflineNoticeProps {
	hostOffline?: boolean
}

/**
 * [P4.9 sessions first] A one-line notice at the top of the session when the host reports the model's
 * API unreachable — what still works matters more than the failure itself, so the line says that rather
 * than just naming the outage.
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
			<span>
				Offline. Local tools, the knowledge already loaded and your files still work; the model and the registry do not.
			</span>
		</div>
	)
}

export default OfflineNotice
