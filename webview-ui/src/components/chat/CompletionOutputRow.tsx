import { Int64Request } from "@shared/proto/cline/common"
import { ArrowRightIcon, CheckIcon } from "lucide-react"
import { memo } from "react"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { CopyButton } from "../common/CopyButton"
import SuccessButton from "../common/SuccessButton"
import { QuoteButtonState } from "./ChatRow"
import { MarkdownRow } from "./MarkdownRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	headClassNames?: string
	showActionRow?: boolean
	seeNewChangesDisabled: boolean
	setSeeNewChangesDisabled: (value: boolean) => void
	explainChangesDisabled: boolean
	setExplainChangesDisabled: (value: boolean) => void
	messageTs: number
}

export const CompletionOutputRow = memo(
	({
		headClassNames,
		text,
		quoteButtonState,
		showActionRow,
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
		handleQuoteClick,
	}: CompletionOutputRowProps) => {
		// "No more Task Complete" (operator direction, CRA workflows first): a completion whose result opens
		// with the invisible <!--NEXT_STEPS--> marker is a HANDOFF, not an ending — render it as a cyan
		// "Suggested next steps" card (brand cyan #00A9CE = the action color, see brandColors.ts) instead of
		// the green terminal banner. The marker is stripped from the rendered markdown.
		const isNextSteps = text.trimStart().startsWith("<!--NEXT_STEPS-->")
		const body = isNextSteps ? text.replace(/^\s*<!--NEXT_STEPS-->\s*/, "") : text
		return (
			<div>
				<div
					className={cn(
						"rounded-sm border overflow-visible p-2 pt-3",
						isNextSteps
							? "border-[color-mix(in_srgb,#00A9CE_35%,transparent)] bg-[color-mix(in_srgb,#00A9CE_8%,transparent)]"
							: "border-success/20 bg-success/10",
					)}>
					{/* Title */}
					<div className={cn(headClassNames, "justify-between px-1")}>
						<div className="flex gap-2 items-center">
							{isNextSteps ? (
								<ArrowRightIcon className="size-3 text-[#00A9CE]" />
							) : (
								<CheckIcon className="size-3 text-success" />
							)}
							{isNextSteps ? (
								<span className="text-[#00A9CE] font-bold">Suggested next steps</span>
							) : (
								<span className="text-success font-bold">Task Completed</span>
							)}
						</div>
						<CopyButton className={isNextSteps ? "text-[#00A9CE]" : "text-success"} textToCopy={body} />
					</div>
					{/* Content */}
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="completion-output-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm">
							<MarkdownRow markdown={body} />
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
					</div>
				</div>
				{/* Action Buttons */}
				{showActionRow && (
					<CompletionOutputActionRow
						explainChangesDisabled={explainChangesDisabled}
						messageTs={messageTs}
						seeNewChangesDisabled={seeNewChangesDisabled}
						setExplainChangesDisabled={setExplainChangesDisabled}
						setSeeNewChangesDisabled={setSeeNewChangesDisabled}
					/>
				)}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"

const CompletionOutputActionRow = memo(
	({
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
	}: {
		seeNewChangesDisabled: boolean
		setSeeNewChangesDisabled: (value: boolean) => void
		explainChangesDisabled: boolean
		setExplainChangesDisabled: (value: boolean) => void
		messageTs: number
	}) => {
		return (
			<div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
				<SuccessButton
					disabled={seeNewChangesDisabled}
					onClick={() => {
						setSeeNewChangesDisabled(true)
						TaskServiceClient.taskCompletionViewChanges(
							Int64Request.create({
								value: messageTs,
							}),
						).catch((err) => console.error("Failed to show task completion view changes:", err))
					}}
					style={{
						cursor: seeNewChangesDisabled ? "wait" : "pointer",
						width: "100%",
					}}>
					<i className="codicon codicon-new-file" style={{ marginRight: 6 }} />
					View Changes
				</SuccessButton>

				{/* {PLATFORM_CONFIG.type === PlatformType.VSCODE && (
					<SuccessButton
						disabled={explainChangesDisabled}
						onClick={() => {
							setExplainChangesDisabled(true)
							TaskServiceClient.explainChanges({
								metadata: {},
								messageTs,
							}).catch((err) => {
								console.error("Failed to explain changes:", err)
								setExplainChangesDisabled(false)
							})
						}}
						style={{
							cursor: explainChangesDisabled ? "wait" : "pointer",
							width: "100%",
						}}>
						<i className="codicon codicon-comment-discussion" style={{ marginRight: 6 }} />
						{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
					</SuccessButton>
				)} */}
			</div>
		)
	},
)
