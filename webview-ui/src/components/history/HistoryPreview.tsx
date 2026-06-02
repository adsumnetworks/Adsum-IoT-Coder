import { StringRequest } from "@shared/proto/cline/common"
import { memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatRelativeTime } from "@/utils/format"
import { detectModeFromTask, MODE_ICONS, NORDIC_MODES } from "../chat/nordicModes"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

type PreviewItem = {
	id: string
	task: string
	ts: number
	isFavorited?: boolean
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const { isDark } = useVSCodeTheme()
	const iconFilter = isDark ? "brightness(0) invert(1)" : "brightness(0)"

	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const displayItems: PreviewItem[] = taskHistory
		.filter((item) => item.ts && item.task)
		.slice(0, 3)
		.map((item) => ({
			id: item.id,
			task: item.task,
			ts: item.ts,
			isFavorited: item.isFavorited,
		}))

	return (
		<div style={{ flexShrink: 0 }}>
			<style>
				{`
					.history-preview-item {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
						border-radius: 4px;
						position: relative;
						overflow: hidden;
						cursor: pointer;
						margin-bottom: 6px;
						padding: 8px 12px;
						display: flex;
						align-items: center;
						gap: 10px;
					}
					.history-preview-item:hover {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
					}
					.history-mode-icon {
						flex-shrink: 0;
						width: 16px;
						height: 16px;
						object-fit: contain;
					}
					.history-task-content {
						flex: 1;
						min-width: 0;
						display: flex;
						align-items: center;
						gap: 6px;
					}
					.history-task-description {
						flex: 1;
						overflow: hidden;
						white-space: nowrap;
						text-overflow: ellipsis;
						color: var(--vscode-foreground);
						font-size: var(--vscode-font-size);
					}
					.history-meta {
						position: relative;
						flex-shrink: 0;
						width: 48px;
						display: flex;
						align-items: center;
						justify-content: flex-end;
					}
					.history-time {
						color: var(--vscode-descriptionForeground);
						font-size: 0.8em;
						white-space: nowrap;
						transition: opacity 0.15s ease;
					}
					.history-resume-chip {
						position: absolute;
						right: 0;
						opacity: 0;
						color: var(--vscode-descriptionForeground);
						font-size: 1.1em;
						transition: opacity 0.15s ease;
					}
					.history-preview-item:hover .history-time {
						opacity: 0;
					}
					.history-preview-item:hover .history-resume-chip {
						opacity: 1;
					}
					.history-view-all-btn {
						background: none;
						border: none;
						padding: 4px 0 4px 8px;
						cursor: pointer;
						font-size: 0.85em;
						font-weight: 500;
						color: var(--vscode-descriptionForeground);
						white-space: nowrap;
						display: flex;
						align-items: center;
						gap: 2px;
					}
					.history-view-all-btn .codicon {
						font-size: 1.2em;
					}
					.history-view-all-btn:hover {
						color: var(--vscode-foreground);
					}
				`}
			</style>

			<div
				className="history-header"
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 16px 8px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span
						className="codicon codicon-comment-discussion"
						style={{ marginRight: "4px", transform: "scale(0.9)" }}
					/>
					<span style={{ fontWeight: 500, fontSize: "0.85em", textTransform: "uppercase" }}>Recent</span>
				</div>
				{displayItems.length > 0 && (
					<button
						aria-label="View all history"
						className="history-view-all-btn"
						onClick={() => showHistoryView()}
						type="button">
						View All
						<span className="codicon codicon-chevron-right" />
					</button>
				)}
			</div>

			<div className="px-4">
				{displayItems.length > 0 ? (
					displayItems.map((item) => {
						const modeId = detectModeFromTask(item.task)
						const modeConfig = modeId ? NORDIC_MODES[modeId] : null
						const displayText = modeConfig ? modeConfig.title : item.task

						return (
							<div className="history-preview-item" key={item.id} onClick={() => handleHistorySelect(item.id)}>
								{modeId && (
									<img
										alt=""
										className="history-mode-icon"
										src={MODE_ICONS[modeId]}
										style={{ filter: iconFilter }}
									/>
								)}
								{!modeId && item.isFavorited && (
									<span
										aria-label="Favorited"
										className="codicon codicon-star-full"
										style={{ color: "var(--vscode-button-background)", flexShrink: 0, fontSize: "0.9em" }}
									/>
								)}
								<div className="history-task-content">
									<div className="history-task-description ph-no-capture">{displayText}</div>
								</div>
								<div className="history-meta">
									<span className="history-time">{formatRelativeTime(item.ts)}</span>
									<span className="history-resume-chip codicon codicon-chevron-right" />
								</div>
							</div>
						)
					})
				) : (
					<div
						style={{
							color: "var(--vscode-descriptionForeground)",
							fontSize: "var(--vscode-font-size)",
							padding: "6px 0",
						}}>
						No recent tasks
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(HistoryPreview)
