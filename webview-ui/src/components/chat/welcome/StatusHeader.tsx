import React from "react"
import EnvStrip from "./EnvStrip"

interface StatusHeaderProps {
	projectName: string | null
}

const StatusHeader: React.FC<StatusHeaderProps> = ({ projectName }) => {
	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				marginBottom: "8px",
			}}>
			{projectName && (
				<div
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						display: "flex",
						alignItems: "center",
						gap: "6px",
					}}>
					<i className="codicon codicon-folder" style={{ fontSize: "13px", color: "var(--vscode-foreground)" }} />
					<span
						style={{
							fontWeight: 600,
							color: "var(--vscode-foreground)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}>
						{projectName}
					</span>
				</div>
			)}
			<EnvStrip />
		</div>
	)
}

export default StatusHeader
