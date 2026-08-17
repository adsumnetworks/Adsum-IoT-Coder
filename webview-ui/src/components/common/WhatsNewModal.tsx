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
							<strong>Project memory</strong> — an <code>.adsum/</code> folder keeps your board, goal and open bugs,
							so a new chat starts already briefed.
						</li>
						<li className="mb-2">
							<strong>Longer sessions</strong> — context bugs fixed, and compaction warns you first and keeps the
							goal, the board and the open file.
						</li>
						<li className="mb-2">
							<strong>Log search</strong> — captures are searched by pattern instead of read whole: 333,000 tokens
							down to a few thousand.
						</li>
						<li className="mb-2">
							<strong>nRF54 and DeepSeek</strong> — deeper board knowledge for the nRF54L15 and nRF54LM20, and
							DeepSeek with thinking you can turn off.
						</li>
					</ul>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
