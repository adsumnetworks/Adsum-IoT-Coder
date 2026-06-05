import React from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"

interface WhatsNewModalProps {
	open: boolean
	onClose: () => void
	version: string
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ open, onClose, version }) => {
	return (
		<Dialog onOpenChange={(isOpen) => !isOpen && onClose()} open={open}>
			<DialogContent
				aria-describedby="whats-new-description"
				aria-labelledby="whats-new-title"
				className="pt-5 px-5 pb-4 gap-0">
				<div id="whats-new-description">
					<h2
						className="text-lg font-semibold mb-3 pr-6"
						id="whats-new-title"
						style={{ color: "var(--vscode-editor-foreground)" }}>
						✦ What's new in v{version}
					</h2>

					<ul className="text-sm pl-3 list-disc" style={{ color: "var(--vscode-descriptionForeground)" }}>
						<li className="mb-2">
							<strong>Real-workspace demo</strong> — one click runs the agent on a real NCS central + peripheral
							project, with actual RTT logs from nRF hardware. No setup needed.
						</li>
						<li className="mb-2">
							<strong>Free tier</strong> — start debugging without an API key. Inference is provided by Adsum
							Networks.
						</li>
						<li className="mb-2">
							<strong>Context-aware guidance</strong> — the welcome screen now detects whether a project is open and
							adapts its suggestions.
						</li>
					</ul>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
