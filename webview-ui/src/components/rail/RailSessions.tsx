import type { HistoryItem } from "@shared/HistoryItem"
import { StringArrayRequest } from "@shared/proto/cline/common"
import { RenameTaskRequest, TaskFavoriteRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { sameFolder } from "../chat/welcome/entryMode"
import { R } from "./railStyles"

const age = (ts: number): string => {
	const d = Date.now() - ts
	const m = Math.round(d / 60000)
	if (m < 1) return "now"
	if (m < 60) return `${m} min`
	const h = Math.round(m / 60)
	if (h < 24) return `${h} h`
	const days = Math.round(h / 24)
	if (days === 1) return "yesterday"
	if (days < 14) return `${days} d`
	return `${Math.round(days / 7)} w`
}

interface Props {
	onAll: () => void
	onNew: () => void
	onOpen: (item: HistoryItem) => void
}

/**
 * [0.5 sessions first] Sessions live here, their one home: five for this folder (title, last step or last
 * message, age), the open-tab and waiting markers, N in other folders, All sessions, +. A row menu holds
 * rename, favourite and delete, bound to the same handlers All sessions uses.
 */
const RailSessions: React.FC<Props> = ({ onAll, onNew, onOpen }) => {
	const { taskHistory, openFolderPaths, openSessions } = useExtensionState()
	const [scope, setScope] = useState(0)
	const [menuFor, setMenuFor] = useState<string | null>(null)
	const roots = openFolderPaths ?? []
	const root = roots.length ? roots[scope % roots.length] : ""
	const folder = root ? root.split("/").pop() : undefined
	const open = useMemo(() => new Map((openSessions ?? []).map((s) => [s.taskId, s])), [openSessions])

	const here = useMemo(() => {
		const all = (taskHistory ?? []).filter((h) => h.ts && h.task)
		const mine = root ? all.filter((h) => sameFolder(h.cwdOnTaskInitialization, root)) : all
		const sorted = [...mine].sort((a, b) => Number(!!b.isFavorited) - Number(!!a.isFavorited) || b.ts - a.ts)
		return { rows: sorted.slice(0, 5), elsewhere: all.length - mine.length }
	}, [taskHistory, root])

	const rename = async (item: HistoryItem) => {
		const title = window.prompt("Name this session", item.title || item.task.slice(0, 60))
		setMenuFor(null)
		if (title === null) return
		await TaskServiceClient.renameTask(RenameTaskRequest.create({ taskId: item.id, title })).catch(() => {})
	}
	const favourite = async (item: HistoryItem) => {
		setMenuFor(null)
		await TaskServiceClient.toggleTaskFavorite(
			TaskFavoriteRequest.create({ taskId: item.id, isFavorited: !item.isFavorited }),
		).catch(() => {})
	}
	const remove = async (item: HistoryItem) => {
		setMenuFor(null)
		if (!window.confirm(`Delete "${item.title || item.task.slice(0, 60)}"?`)) return
		await TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [item.id] })).catch(() => {})
	}

	return (
		<div data-testid="rail-sessions" style={R.block}>
			<div style={R.blockHead}>
				<span style={{ ...R.label, display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
					Sessions
					{roots.length > 1 ? (
						<button
							onClick={() => setScope((s) => s + 1)}
							style={{
								...R.link,
								fontSize: 10,
								letterSpacing: 0,
								textTransform: "none",
								color: "var(--vscode-foreground)",
								border: "1px solid color-mix(in srgb, var(--vscode-foreground) 30%, transparent)",
								borderRadius: 9,
								padding: "0 7px",
							}}
							title="The target of the next session and the scope of this list"
							type="button">
							{folder} ▾
						</button>
					) : folder ? (
						<span style={{ textTransform: "none", letterSpacing: 0 }}>· {folder}</span>
					) : null}
				</span>
				<button onClick={onNew} style={R.link} type="button">
					+ new
				</button>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
				{here.rows.map((h, i) => {
					const o = open.get(h.id)
					return (
						<div key={h.id} style={{ position: "relative" }}>
							<button
								onClick={() => onOpen(h)}
								style={{
									display: "flex",
									justifyContent: "space-between",
									gap: 8,
									alignItems: "baseline",
									padding: "4px 8px",
									borderRadius: 5,
									background: "none",
									border: `1px solid ${i === 0 ? "var(--adsum-cyan)" : "transparent"}`,
									color: "var(--vscode-foreground)",
									font: "inherit",
									textAlign: "left",
									width: "100%",
									cursor: "pointer",
								}}
								title={o ? "Open in a tab: click focuses it" : "Opens in a tab"}
								type="button">
								<span style={{ minWidth: 0 }}>
									<span
										style={{
											...R.title,
											fontSize: 12,
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
											display: "block",
										}}>
										{h.isFavorited ? <span style={{ color: R.coral, marginRight: 4 }}>★</span> : null}
										{h.title?.trim() || h.task}
									</span>
									<span
										style={{
											...R.meta,
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
											display: "block",
										}}>
										{h.handoverId ? (
											<span
												style={{
													...R.kind,
													marginLeft: 0,
													marginRight: 6,
													color: "var(--adsum-cyan-text)",
												}}>
												handover
											</span>
										) : null}
										{o ? (
											<span
												style={{
													...R.kind,
													marginLeft: 0,
													marginRight: 6,
													color: "var(--adsum-cyan-text)",
												}}>
												open
											</span>
										) : null}
										{o?.waiting ? (
											<span style={{ ...R.kind, marginLeft: 0, marginRight: 6, color: R.warn }}>
												waiting on you
											</span>
										) : null}
										{o?.streaming ? "working…" : h.modelId ? h.modelId : ""}
									</span>
								</span>
								<span style={{ ...R.meta, flex: "none" }}>{age(h.ts)}</span>
							</button>
							<button
								aria-label="Rename, favourite, delete"
								onClick={() => setMenuFor(menuFor === h.id ? null : h.id)}
								style={{
									position: "absolute",
									right: 4,
									top: 3,
									font: "inherit",
									fontSize: 12,
									color: "var(--vscode-descriptionForeground)",
									background: "var(--vscode-sideBar-background)",
									border: "1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent)",
									borderRadius: 3,
									padding: "0 5px",
									cursor: "pointer",
								}}
								type="button">
								⋯
							</button>
							{menuFor === h.id && (
								<div
									role="menu"
									style={{
										position: "absolute",
										right: 4,
										top: 22,
										zIndex: 4,
										background: "var(--vscode-editorWidget-background)",
										border: "1px solid var(--vscode-panel-border, color-mix(in srgb, var(--vscode-foreground) 20%, transparent))",
										borderRadius: 6,
										padding: 4,
										display: "flex",
										flexDirection: "column",
										minWidth: 140,
									}}>
									<button
										onClick={() => void rename(h)}
										role="menuitem"
										style={{
											...R.link,
											color: "var(--vscode-foreground)",
											textAlign: "left",
											padding: "5px 10px",
											fontSize: 12,
										}}
										type="button">
										Rename
									</button>
									<button
										onClick={() => void favourite(h)}
										role="menuitem"
										style={{
											...R.link,
											color: "var(--vscode-foreground)",
											textAlign: "left",
											padding: "5px 10px",
											fontSize: 12,
										}}
										type="button">
										{h.isFavorited ? "Unfavourite" : "Favourite"}
									</button>
									<button
										onClick={() => void remove(h)}
										role="menuitem"
										style={{
											...R.link,
											color: "var(--vscode-foreground)",
											textAlign: "left",
											padding: "5px 10px",
											fontSize: 12,
										}}
										type="button">
										Delete…
									</button>
								</div>
							)}
						</div>
					)
				})}
				{here.rows.length === 0 && (
					<div style={{ ...R.meta, padding: "2px 8px" }}>
						Nothing has run {folder ? `in ${folder}` : "in this window"} yet. A suggestion, the palette or + starts
						its first session.
					</div>
				)}
				{(here.elsewhere > 0 || here.rows.length > 0) && (
					<div style={{ ...R.meta, padding: "2px 8px" }}>
						{here.elsewhere > 0
							? `${here.elsewhere} session${here.elsewhere > 1 ? "s" : ""} in other folders · `
							: ""}
						<button onClick={onAll} style={R.link} type="button">
							All sessions →
						</button>
					</div>
				)}
			</div>
		</div>
	)
}

export default RailSessions
