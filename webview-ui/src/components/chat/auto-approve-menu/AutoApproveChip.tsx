import { ZapIcon } from "lucide-react"
import { useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import AutoApproveModal from "./AutoApproveModal"
import { ACTION_METADATA } from "./constants"

/**
 * Compact auto-approve trigger for the input's bottom controls row (operator 0707: Claude Code-style mode
 * chip next to the @ button) — replaces the full-width AutoApproveBar row that sat ABOVE the input. Reuses
 * the existing AutoApproveModal, opening it UPWARD as a popover instead of expanding inline.
 */
const AutoApproveChip = () => {
	const { autoApprovalSettings, yoloModeToggled, navigateToSettings } = useExtensionState()
	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)

	// Same short-name summary the old bar computed: enabled actions, a parent hidden when its subaction is on.
	const summary = (() => {
		if (yoloModeToggled) {
			return "YOLO"
		}
		const enabledIds = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
		)
		const names = enabledIds
			.map((id) => ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === id))
			.filter((a) => {
				if (!a?.shortName) {
					return false
				}
				if (a.subAction?.id && enabledIds.includes(a.subAction.id)) {
					return false
				}
				return true
			})
			.map((a) => a?.shortName)
		return names.length ? names.join(", ") : "None"
	})()

	const handleToggle = () => {
		if (yoloModeToggled) {
			// YOLO is a settings-level switch — the modal's toggles are moot while it's on.
			navigateToSettings("features")
			return
		}
		setIsModalVisible((prev) => !prev)
	}

	return (
		<div className="relative flex items-center min-w-0">
			{/* App Tooltip (instant), matching the @ button — not the native title= (browser-delayed/flaky). */}
			<Tooltip>
				<TooltipContent>Auto-approve settings</TooltipContent>
				<TooltipTrigger>
					<div
						aria-label="Auto-approve settings"
						className="flex items-center gap-0.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
						onClick={handleToggle}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								handleToggle()
							}
						}}
						ref={buttonRef}
						tabIndex={0}>
						<ZapIcon size={11} />
						<span className="truncate max-w-[140px]">{summary}</span>
					</div>
				</TooltipTrigger>
			</Tooltip>
			{isModalVisible && (
				<div
					className="absolute bottom-6 left-0 z-[1000] w-[min(420px,calc(100vw-40px))] rounded-md pt-2"
					style={{
						background: "var(--vscode-editor-background)",
						border: "1px solid var(--vscode-editorGroup-border)",
						boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
					}}>
					<AutoApproveModal
						ACTION_METADATA={ACTION_METADATA}
						buttonRef={buttonRef}
						isVisible={isModalVisible}
						setIsVisible={setIsModalVisible}
					/>
				</div>
			)}
		</div>
	)
}

export default AutoApproveChip
