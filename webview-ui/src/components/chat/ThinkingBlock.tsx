import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo } from "react"
import { cn } from "@/lib/utils"
import { MarkdownRow } from "./MarkdownRow"

interface ThinkingBlockProps {
	content?: string
	isStreaming: boolean
	durationMs?: number
	isExpanded: boolean
	onToggle: () => void
}

function formatDuration(ms: number): string {
	if (ms < 1000) return "< 1s"
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`
	const m = Math.floor(ms / 60_000)
	const s = Math.round((ms % 60_000) / 1000)
	return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export const ThinkingBlock = memo(({ content, isStreaming, durationMs, isExpanded, onToggle }: ThinkingBlockProps) => {
	if (!content && !isStreaming) return null

	const label = isStreaming ? "Thinking" : durationMs != null ? `Thought for ${formatDuration(durationMs)}` : "Thought"

	return (
		<div className="ml-1 my-1.5">
			<button
				className="flex items-center gap-1.5 text-description hover:text-foreground text-sm cursor-pointer w-full text-left select-none"
				onClick={onToggle}
				type="button">
				<span className="italic font-medium">{label}</span>
				{isStreaming && <span className="thinking-dots" />}
				{!isStreaming &&
					(isExpanded ? (
						<ChevronDownIcon className="ml-auto size-3 opacity-50 shrink-0" />
					) : (
						<ChevronRightIcon className="ml-auto size-3 opacity-50 shrink-0" />
					))}
			</button>

			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-200 ease-out",
					isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}>
				<div className="overflow-hidden">
					{content && (
						<div className="border-l-2 border-description/30 pl-3 mt-1 ml-1 text-description text-sm leading-relaxed">
							<MarkdownRow markdown={content} showCursor={false} />
						</div>
					)}
				</div>
			</div>
		</div>
	)
})

ThinkingBlock.displayName = "ThinkingBlock"
