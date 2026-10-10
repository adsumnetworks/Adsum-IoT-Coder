import { StringRequest } from "@shared/proto/cline/common"
import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { AdsumServiceClient } from "@/services/grpc-client"
import { R } from "./railStyles"

interface Artifact {
	path: string
	sha256: string
	size: number
}
interface Entry {
	id: string
	version: string
	family: string | null
	rung: string | null
	group: string | null
	title: string
	summary: string | null
	security: boolean
	released_at: string | null
	entitled: boolean
	artifacts: Artifact[]
	licence: { id: string; termMonths: number }
}
interface Local {
	folder: string
	intact: boolean
	receipt: { licensee: string; term_end: string; status: "active" | "expired"; downloaded_at: string }
}
interface Row {
	entry: Entry
	local: Local | null
	state: "download" | "flash" | "renew" | "ask" | "coming"
	folder: string
}

const call = async (req: Record<string, unknown>) => {
	const r = await AdsumServiceClient.firmware(StringRequest.create({ value: JSON.stringify(req) }))
	return JSON.parse(r.value || "{}")
}

interface Props {
	family?: string
	/** Starts a session that flashes from the folder; the prompt names family, version, licensee and path. */
	onFlash: (prompt: string) => void
	onAsk: () => void
	onRenew: () => void
}

/**
 * [0.5 the firmware lane] The version rows of the Hardware page: every published firmware version for the
 * family with one action per state. Download confirms what goes where and asks the server fresh; Flash
 * opens a session with the line that names family, version, licensee and path; a version outside the
 * account's rungs is a state (Renew, Ask), never a wall; a receipt past its term still flashes.
 */
const FirmwareRungs: React.FC<Props> = ({ family, onFlash, onAsk, onRenew }) => {
	const [rows, setRows] = useState<Row[] | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [confirm, setConfirm] = useState<Row | null>(null)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		try {
			const res = await call({ op: "list", family })
			setRows(res.ok ? res.rows : [])
		} catch {
			setRows([])
		}
	}, [family])
	useEffect(() => {
		void load()
	}, [load])

	const download = async (row: Row, pick: boolean) => {
		setConfirm(null)
		setBusy(`${row.entry.id}@${row.entry.version}`)
		setError(null)
		try {
			const res = await call({ op: "download", id: row.entry.id, version: row.entry.version, pick })
			if (!res.ok && !res.cancelled) {
				setError(
					res.locked
						? `Not in your account${res.group ? ` (${res.group})` : ""}. Renew or ask on the web Hardware home.`
						: res.error || "download failed",
				)
			}
			await load()
		} finally {
			setBusy(null)
		}
	}

	if (rows === null) {
		return <div style={R.meta}>reading the firmware list…</div>
	}
	if (rows.length === 0) {
		return <div style={R.meta}>No firmware versions are listed for this board yet.</div>
	}
	return (
		<div data-testid="firmware-rungs" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<div style={R.label}>Firmware versions</div>
			{rows.map((row) => {
				const e = row.entry
				const key = `${e.id}@${e.version}`
				const term = row.local?.receipt.term_end?.slice(0, 10)
				const expired = row.local?.receipt.status === "expired"
				return (
					<div
						key={key}
						style={{
							border: "1px solid color-mix(in srgb, var(--vscode-foreground) 14%, transparent)",
							borderRadius: 8,
							padding: "8px 10px",
							display: "flex",
							flexDirection: "column",
							gap: 4,
						}}>
						<div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
							<span style={R.title}>
								{e.title}{" "}
								<span
									style={{
										fontFamily: "var(--vscode-editor-font-family)",
										fontSize: 11,
										color: "var(--vscode-descriptionForeground)",
									}}>
									v{e.version}
								</span>
								{e.security ? (
									<span style={{ ...R.kind, color: "var(--adsum-cyan-text)" }}>security release</span>
								) : null}
							</span>
							<span style={{ ...R.meta, whiteSpace: "nowrap", color: "var(--adsum-cyan-text)" }}>
								{row.state === "flash"
									? expired
										? "yours · term ended"
										: "yours · on disk"
									: row.state === "download"
										? row.local
											? "on disk, a file is altered"
											: "yours · download"
										: row.state === "renew"
											? "renew to have this"
											: row.state === "ask"
												? "opened on request"
												: "needs a newer build"}
							</span>
						</div>
						{e.summary ? <div style={R.meta}>{e.summary}</div> : null}
						{row.local ? (
							<div style={R.meta}>
								Licensed to {row.local.receipt.licensee}
								{term ? ` · ${expired ? "term ended" : "until"} ${term}` : ""} · {row.folder}
							</div>
						) : null}
						<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
							{row.state === "flash" && (
								<>
									<button
										onClick={() =>
											onFlash(
												`Flash ${e.title} v${e.version}, licensed to ${row.local?.receipt.licensee}, from ${row.folder}: use the files listed in ${row.folder}/adsum-firmware.json, say the flash line first, and ask me which probe or port is which before you program anything.`,
											)
										}
										style={R.pill("pri")}
										type="button">
										Flash v{e.version}
									</button>
									<button
										onClick={() => void call({ op: "open-folder", folder: row.folder })}
										style={R.pill()}
										type="button">
										Open folder
									</button>
								</>
							)}
							{row.state === "download" && (
								<button
									disabled={busy === key}
									onClick={() => setConfirm(row)}
									style={R.pill("pri")}
									type="button">
									{busy === key ? "downloading…" : `Download v${e.version}`}
								</button>
							)}
							{row.state === "renew" && (
								<button onClick={onRenew} style={R.pill()} type="button">
									Renew in the browser
								</button>
							)}
							{row.state === "ask" && (
								<button onClick={onAsk} style={R.pill("pri")} type="button">
									Ask for more details
								</button>
							)}
						</div>
						{confirm === row && (
							<div
								style={{
									border: "1px solid var(--adsum-cyan)",
									borderRadius: 6,
									padding: "8px 10px",
									marginTop: 4,
									display: "flex",
									flexDirection: "column",
									gap: 6,
								}}>
								<div style={R.body}>
									Download{" "}
									<b>
										{e.title} v{e.version}
									</b>{" "}
									into <code style={{ fontSize: 11 }}>{row.folder}</code>, with its licence file and a receipt
									beside it. The authorisation is checked on the server now, not from a cached account. The
									agent is told the path and the licence, never the bytes.
								</div>
								<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
									<button onClick={() => void download(row, false)} style={R.pill("pri")} type="button">
										Download here
									</button>
									<button onClick={() => void download(row, true)} style={R.pill()} type="button">
										Choose another folder…
									</button>
									<button onClick={() => setConfirm(null)} style={R.pill()} type="button">
										Not now
									</button>
								</div>
							</div>
						)}
					</div>
				)
			})}
			{error ? <div style={{ ...R.meta, color: "var(--vscode-errorForeground)" }}>{error}</div> : null}
			<div style={{ ...R.meta, fontSize: 10.5 }}>
				Nothing is hidden: a version outside the term is a state, not a wall. Flash always flashes the newest covered
				version and says which. Renew opens the browser, because money never moves here.
			</div>
		</div>
	)
}

export default FirmwareRungs
