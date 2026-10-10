import type { ClineMessage } from "@shared/ExtensionMessage"
import { AskResponseRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useState } from "react"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { Info } from "@/components/common/Info"
import { R } from "@/components/rail/railStyles"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { APPROVAL_ASK_TYPES, autoApproveActionFor } from "@/utils/autoApproveAction"

export interface InlineApprovalRowProps {
	message: ClineMessage
	/** Whether this ask is the one actually waiting on an answer right now — the same `isLast` test
	 *  ChatRow/ActionButtons already use. A row with no live answer owed renders nothing: the mode
	 *  either auto-approved this one already, or a later message has moved past it. */
	isLast: boolean
}

/**
 * [0.5 simple] Approvals as the exception path: Allow (the one action, a real primary pill), Always
 * allow (a ghost pill, honestly named — the setting it touches is global, not this session) and Deny
 * (ghost). "Always allow" sets the matching entry in the existing auto-approve settings (the same RPC
 * the auto-approve menu uses) before approving, so the next matching ask anywhere does not come back;
 * an Info beside it says so, since the label alone cannot carry "every session, change it in Settings".
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

	const alwaysAllow = () => {
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
			<button data-testid="inline-approval-allow" disabled={busy} onClick={allow} style={R.pill("pri")} type="button">
				Allow
			</button>
			<button
				data-testid="inline-approval-always-allow"
				disabled={busy}
				onClick={alwaysAllow}
				style={R.pill("ghost")}
				type="button">
				Always allow
			</button>
			<Info text="Allows this kind of action without asking, in every session. Change it in Settings." />
			<button data-testid="inline-approval-deny" disabled={busy} onClick={deny} style={R.pill("ghost")} type="button">
				Deny
			</button>
		</div>
	)
}

export default InlineApprovalRow
