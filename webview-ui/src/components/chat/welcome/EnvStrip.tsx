import type { NrfBoard } from "@shared/nrf"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"

const EnvStrip: React.FC = () => {
	const { nrfEnvironment } = useExtensionState()
	const [refreshing, setRefreshing] = useState(false)

	const handleRefresh = () => {
		if (refreshing) {
			return
		}
		setRefreshing(true)
		FileServiceClient.refreshNrfEnvironment(EmptyRequest.create())
			.catch(() => {})
			.finally(() => setRefreshing(false))
	}

	const env = nrfEnvironment ?? { status: "unknown", extensionPresent: false, nrfutilPresent: false, boards: [] }

	const envLabel = env.extensionPresent ? `nRF Connect ext v${env.extensionVersion ?? "?"}` : "nRF Connect not detected"

	let boardsLabel: string
	if (env.status === "unknown" || env.status === "detecting") {
		boardsLabel = "detecting…"
	} else if (!env.nrfutilPresent) {
		boardsLabel = "nrfutil not found"
	} else if (env.boards.length === 0) {
		boardsLabel = "no boards connected"
	} else {
		const names = env.boards.map((b: NrfBoard) => b.deviceName ?? b.deviceFamily ?? b.serialNumber).join(", ")
		boardsLabel = `${env.boards.length} board${env.boards.length > 1 ? "s" : ""} (${names})`
	}

	const isSpinning = env.status === "detecting" || refreshing

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "10px",
				fontSize: "11px",
				color: "var(--vscode-descriptionForeground)",
				flexWrap: "wrap",
			}}>
			{/* nRF Connect extension line */}
			<span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
				<i className="codicon codicon-server-environment" style={{ fontSize: "12px" }} />
				{envLabel}
			</span>

			<span style={{ opacity: 0.4 }}>·</span>

			{/* Boards line */}
			<span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
				<i className="codicon codicon-plug" style={{ fontSize: "12px" }} />
				{boardsLabel}
			</span>

			{/* Refresh button */}
			<button
				aria-label="Refresh nRF environment"
				disabled={isSpinning}
				onClick={handleRefresh}
				style={{
					background: "none",
					border: "none",
					cursor: isSpinning ? "default" : "pointer",
					padding: "0",
					color: "var(--vscode-descriptionForeground)",
					opacity: isSpinning ? 0.5 : 0.7,
					display: "inline-flex",
					alignItems: "center",
				}}
				title="Re-probe nRF Connect extension and connected boards"
				type="button">
				<i
					className={`codicon codicon-refresh${isSpinning ? " codicon-modifier-spin" : ""}`}
					style={{ fontSize: "12px" }}
				/>
			</button>
		</div>
	)
}

export default EnvStrip
