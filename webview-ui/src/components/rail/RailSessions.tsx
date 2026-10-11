import type { HistoryItem } from "@shared/HistoryItem"
import { StringArrayRequest } from "@shared/proto/cline/common"
import { RenameTaskRequest, TaskFavoriteRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { sameFolder } from "../chat/welcome/entryMode"
import Truncate from "../common/Truncate"
import { R } from "./railStyles"
import { Chevron, useSectionOpen } from "./useSectionOpen"

const age = (ts: number): string => {
	const d = Date.now() - ts
	const m = Math.round(d / 60000)
	if (m < 1) {
		return "now"
	}
	if (m < 60) {
		return `${m} min`
	}
	const h = Math.round(m / 60)
	if (h < 24) {
		return `${h} h`
	}
	const days = Math.round(h / 24)
	if (days === 1) {
		return "yesterday"
	}
	if (days < 14) {
		return `${days} d`
	}
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
	const [shown, toggleShown] = useSectionOpen("sessions")
	const [scope, setScope] = useState(0)
	const [menuFor, setMenuFor] = useState<string | null>(null)
	// An open row menu closes on a click anywhere outside it and on Escape, as any menu does (the ⋯ toggles it;
	// a click elsewhere used to leave it open over the next row).
	useEffect(() => {
		if (!menuFor) {
			return
		}
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element) || !e.target.closest("[data-session-menu]")) {
				setMenuFor(null)
			}
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setMenuFor(null)
			}
		}
		document.addEventListener("pointerdown", onDown)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown)
			document.removeEventListener("keydown", onKey)
		}
	}, [menuFor])
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

	// VS Code webviews block window.prompt and window.confirm: renaming and deleting happen in the row.
	const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
	const [confirming, setConfirming] = useState<string | null>(null)
	const rename = (item: HistoryItem) => {
		setMenuFor(null)
		setEditing({ id: item.id, title: item.title || item.task.slice(0, 60) })
	}
	const saveRename = async () => {
		if (!editing) {
			return
		}
		const { id, title } = editing
		setEditing(null)
		await TaskServiceClient.renameTask(RenameTaskRequest.create({ taskId: id, title: title.trim() })).catch(() => {})
	}
	const favourite = async (item: HistoryItem) => {
		setMenuFor(null)
		await TaskServiceClient.toggleTaskFavorite(
			TaskFavoriteRequest.create({ taskId: item.id, isFavorited: !item.isFavorited }),
		).catch(() => {})
	}
	const remove = (item: HistoryItem) => {
		setConfirming(item.id)
	}
	const reallyRemove = async (id: string) => {
		setConfirming(null)
		setMenuFor(null)
		await TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [id] })).catch(() => {})
	}

	return (
		<div data-testid="rail-sessions" style={R.block}>
			<div style={R.blockHead}>
				<span style={{ ...R.label, display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
					<button aria-expanded={shown} onClick={toggleShown} style={R.sectionToggle} type="button">
						<Chevron open={shown} />
						<span style={R.label}>Sessions</span>
						{here.rows.length > 0 ? (
							<span
								style={{
									...R.label,
									letterSpacing: 0,
									padding: "0 5px",
									borderRadius: 8,
									background: "color-mix(in srgb, var(--vscode-foreground) 12%, transparent)",
								}}>
								{here.rows.length}
							</span>
						) : null}
					</button>
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
			</div>
			{shown && (
				<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
					<button
						className="rail-row"
						data-testid="rail-new-session"
						onClick={onNew}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							padding: "5px 8px",
							borderRadius: 5,
							border: "1px solid transparent",
							background: "none",
							color: "var(--vscode-foreground)",
							font: "inherit",
							fontSize: 12,
							textAlign: "left",
							width: "100%",
							cursor: "pointer",
						}}
						type="button">
						<span
							aria-hidden="true"
							style={{ width: 8, textAlign: "center", color: "var(--adsum-cyan-text)", fontWeight: 700 }}>
							+
						</span>
						New session
					</button>
					{here.rows.map((h, i) => {
						const o = open.get(h.id)
						return (
							// The row and its ⋯ sit side by side. The ⋯ used to float over the row's top right corner,
							// which is where the age is: "12 min" read as a clipped number under it. The menu panel
							// still hangs from this wrapper.
							<div
								data-testid="rail-session-row"
								key={h.id}
								style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 4 }}>
								<button
									className="rail-row"
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
										flex: 1,
										minWidth: 0,
										cursor: "pointer",
									}}
									title={o ? "Open in a tab: click focuses it" : "Opens in a tab"}
									type="button">
									<span style={{ minWidth: 0 }}>
										<span
											style={{
												...R.title,
												fontSize: 12,
												display: "flex",
												alignItems: "center",
												minWidth: 0,
											}}>
											<span
												aria-label={
													o?.streaming ? "working" : o?.waiting ? "waiting on you" : o ? "open" : "idle"
												}
												role="img"
												style={{
													display: "inline-block",
													width: 7,
													height: 7,
													borderRadius: "50%",
													marginRight: 6,
													flex: "none",
													background: o?.streaming
														? "var(--vscode-testing-iconPassed, #3fb950)"
														: o?.waiting
															? R.warn
															: o
																? "var(--vscode-foreground)"
																: "color-mix(in srgb, var(--vscode-foreground) 28%, transparent)",
												}}
											/>
											{h.isFavorited ? <span style={{ color: R.coral, marginRight: 4 }}>★</span> : null}
											{editing?.id === h.id ? (
												<input
													aria-label="Session name"
													autoFocus
													onBlur={() => void saveRename()}
													onChange={(e) => setEditing({ id: h.id, title: e.target.value })}
													onClick={(e) => e.stopPropagation()}
													onKeyDown={(e) => {
														if (e.key === "Enter") {
															void saveRename()
														}
														if (e.key === "Escape") {
															setEditing(null)
														}
													}}
													style={{
														font: "inherit",
														width: "100%",
														background: "var(--vscode-input-background)",
														color: "var(--vscode-input-foreground)",
														border: "1px solid var(--vscode-focusBorder)",
														borderRadius: 3,
														padding: "0 4px",
													}}
													value={editing.title}
												/>
											) : (
												<Truncate text={h.title?.trim() || h.task} />
											)}
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
											{o?.waiting ? (
												<span style={{ ...R.kind, marginLeft: 0, marginRight: 6, color: R.warn }}>
													waiting on you
												</span>
											) : null}
											{o?.streaming ? "working…" : h.modelId ? h.modelId : ""}
										</span>
									</span>
									<span
										data-testid="rail-session-age"
										style={{ ...R.meta, flex: "none", whiteSpace: "nowrap" }}>
										{age(h.ts)}
									</span>
								</button>
								<button
									aria-expanded={menuFor === h.id}
									aria-haspopup="menu"
									aria-label="Rename, favourite, delete"
									data-session-menu="button"
									onClick={() => setMenuFor(menuFor === h.id ? null : h.id)}
									style={{
										flex: "none",
										marginTop: 3,
										font: "inherit",
										fontSize: 12,
										color: "var(--vscode-descriptionForeground)",
										background: "none",
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
										data-session-menu="panel"
										role="menu"
										style={{
											position: "absolute",
											right: 0,
											top: 24,
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
										{confirming === h.id ? (
											<span
												style={{
													display: "flex",
													gap: 8,
													alignItems: "center",
													padding: "5px 10px",
													fontSize: 12,
												}}>
												Delete?
												<button
													onClick={() => void reallyRemove(h.id)}
													role="menuitem"
													style={{ ...R.link, color: "var(--vscode-errorForeground)" }}
													type="button">
													Yes
												</button>
												<button
													onClick={() => setConfirming(null)}
													role="menuitem"
													style={R.link}
													type="button">
													No
												</button>
											</span>
										) : (
											<button
												onClick={() => remove(h)}
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
										)}
									</div>
								)}
							</div>
						)
					})}
					{here.rows.length === 0 && (
						<div style={{ ...R.meta, padding: "2px 8px" }}>No sessions {folder ? `in ${folder}` : "here"} yet</div>
					)}
					{(here.elsewhere > 0 || here.rows.length > 0) && (
						<div style={{ ...R.meta, padding: "2px 8px" }}>
							<button onClick={onAll} style={R.link} type="button">
								All sessions{here.elsewhere > 0 ? ` (${here.elsewhere} elsewhere)` : ""} →
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default RailSessions
