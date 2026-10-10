import type { ClineMessage } from "@shared/ExtensionMessage"
import { AskResponseRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useState } from "react"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { R } from "@/components/rail/railStyles"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { APPROVAL_ASK_TYPES, autoApproveActionFor } from "@/utils/autoApproveAction"
import { BRAND_CYAN_TEXT } from "./brandColors"

export interface InlineApprovalRowProps {
	message: ClineMessage
	/** Whether this ask is the one actually waiting on an answer right now — the same `isLast` test
	 *  ChatRow/ActionButtons already use. A row with no live answer owed renders nothing: the mode
	 *  either auto-approved this one already, or a later message has moved past it. */
	isLast: boolean
}

/**
 * [P4.3 sessions first] Approvals as the exception path: an inline row with three controls — Allow,
 * Allow for this session, Deny — appearing only on an ask the mode did not already answer itself. Allow
 * for this session sets the matching entry in the existing auto-approve settings (the same RPC the
 * auto-approve menu uses) before approving, so the next matching ask in the task does not come back.
 */
const InlineApprovalRow: React.FC<InlineApprovalRowProps> = ({ message, isLast }) => {
	const { autoApprovalSettings } = useExtensionState()
	const [busy, setBusy] = useState(false)

	const isLiveApprovalAsk = message.type === "ask" && !message.partial && APPROVAL_ASK_TYPES.has(message.ask) && isLast
	if (!isLiveApprovalAsk) {
		return null
	}

	const respond = (responseType: "yesButtonClicked" | "noButtonClicked") => {
		setBusy(true)
		TaskServiceClient.askResponse(AskResponseRequest.create({ responseType })).catch((error) =>
			console.error("Error sending ask response:", error),
		)
	}

	const allow = () => respond("yesButtonClicked")

	const allowForSession = () => {
		const actionKey = autoApproveActionFor(message)
		if (actionKey) {
			updateAutoApproveSettings({
				...autoApprovalSettings,
				actions: { ...autoApprovalSettings.actions, [actionKey]: true },
			}).catch((error) => console.error("Error updating auto-approve settings:", error))
		}
		respond("yesButtonClicked")
	}

	const deny = () => respond("noButtonClicked")

	return (
		<div className="flex items-center gap-2 px-4" data-testid="inline-approval-row" style={{ padding: "4px 14px" }}>
			<button
				data-testid="inline-approval-allow"
				disabled={busy}
				onClick={allow}
				style={{ ...R.meta, color: BRAND_CYAN_TEXT, fontWeight: 600 }}
				type="button">
				Allow
			</button>
			<button
				data-testid="inline-approval-allow-session"
				disabled={busy}
				onClick={allowForSession}
				style={{ ...R.meta, color: "var(--vscode-foreground)" }}
				type="button">
				Allow for this session
			</button>
			<button
				data-testid="inline-approval-deny"
				disabled={busy}
				onClick={deny}
				style={{ ...R.meta, color: "var(--vscode-descriptionForeground)" }}
				type="button">
				Deny
			</button>
		</div>
	)
}

export default InlineApprovalRow
