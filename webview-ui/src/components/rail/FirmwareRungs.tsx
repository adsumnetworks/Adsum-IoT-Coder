import { StringRequest } from "@shared/proto/cline/common"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { AdsumServiceClient } from "@/services/grpc-client"
import Info from "../common/Info"
import { Truncate } from "../common/Truncate"
import { flashPrompt, flashTitle } from "./flashPrompt"
import { R } from "./railStyles"

interface Artifact {
	path: string
	sha256: string
	size: number
}
export interface Entry {
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
export interface Local {
	folder: string
	intact: boolean
	receipt: {
		licensee: string
		term_end: string
		status: "active" | "expired"
		downloaded_at: string
		family?: string | null
		artifacts?: Array<{ path: string }>
	}
}
export interface Row {
	entry: Entry
	local: Local | null
	state: "flash" | "download" | "register" | "renew" | "ask"
	folder: string
}

/** What the host's firmware op answers: the rows for a list, the outcome for a download. */
export interface FirmwareReply {
	ok?: boolean
	rows?: Row[]
	cancelled?: boolean
	locked?: boolean
	group?: string | null
	error?: string
}
export type FirmwareCall = (req: Record<string, unknown>) => Promise<FirmwareReply>

const hostCall: FirmwareCall = async (req) => {
	const r = await AdsumServiceClient.firmware(StringRequest.create({ value: JSON.stringify(req) }))
	return JSON.parse(r.value || "{}") as FirmwareReply
}

/** A folder in the workspace reads from `firmware/` on; one chosen elsewhere keeps its whole path. */
const shortFolder = (folder: string) => folder.replace(/^.*?[\\/](firmware[\\/])/, "$1")

/** The host's firmware op, replaceable so a story can draw every row state with no host behind it. */
export const FirmwareCallContext = createContext<FirmwareCall>(hostCall)

interface Props {
	family?: string
	/**
	 * Starts a session that flashes from the folder; the prompt names family, version, licensee and path, and
	 * the title names its tab ("Flash BLG20x production pair v2.3.0").
	 */
	onFlash: (prompt: string, title: string) => void
	onAsk: () => void
	onRenew: () => void
	/** No account yet: the free registration opens the demo rungs. */
	onRegister: () => void
	/**
	 * A way onto the unit only the unit on the desk can tell (the LBG20x over Bluetooth), one sentence the
	 * Bluetooth lane supplies; the Flash prompt puts it first. Absent: the folder's own files decide.
	 */
	unitRoute?: string | ((folder: string) => string | undefined)
	/** How the route reaches the unit, said on the Flash button when there is a route: "over Bluetooth". */
	unitDoor?: string
}

/**
 * [0.5 the firmware lane] The version rows of the Hardware page: every published firmware version for the
 * family with one action per state. Download confirms what goes where and asks the server fresh; Flash
 * opens a session with the line that names family, version, licensee and path; a version outside the
 * account's rungs is a state (Renew, Ask), never a wall; a receipt past its term still flashes.
 */
const FirmwareRungs: React.FC<Props> = ({ family, onFlash, onAsk, onRenew, onRegister, unitRoute, unitDoor }) => {
	// The route names the version's own folder, so it is asked per row (a plain sentence is used as it is).
	const routeFor = (folder: string) => (typeof unitRoute === "function" ? unitRoute(folder) : unitRoute)
	const [rows, setRows] = useState<Row[] | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [confirm, setConfirm] = useState<Row | null>(null)
	const [error, setError] = useState<string | null>(null)
	const call = useContext(FirmwareCallContext)

	const load = useCallback(async () => {
		try {
			const res = await call({ op: "list", family })
			setRows(res.ok ? (res.rows ?? []) : [])
		} catch {
			setRows([])
		}
	}, [family, call])
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
						? `Not in your account${res.group ? ` (${res.group})` : ""}. Ask to renew from this page.`
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
			<div style={{ ...R.label, display: "flex", alignItems: "center", gap: 6 }}>
				Firmware versions
				<Info text="Every published version, each with the one thing you can do with it now. A version you do not hold can still be asked for; files you downloaded stay yours to flash after the term ends. Renewing is a request to the Adsum team: nothing is paid for in the editor." />
			</div>
			{rows.map((row, i) => {
				const e = row.entry
				// One focal action per view: the first row that can act gets the filled button, the rest are quiet.
				const focal = i === rows.findIndex((r) => r.state !== "renew")
				const lead = focal ? R.pill("pri") : R.pill()
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
							<span data-testid="firmware-row-state" style={{ ...R.meta, whiteSpace: "nowrap" }}>
								{row.state === "flash"
									? expired
										? "yours · term ended"
										: "yours · on disk"
									: row.state === "download"
										? row.local
											? "on disk, a file is altered"
											: "yours · download"
										: row.state === "register"
											? "free with an account"
											: row.state === "renew"
												? "renew to have this"
												: "opened on request"}
							</span>
						</div>
						{e.summary ? <div style={R.meta}>{e.summary}</div> : null}
						{row.local ? (
							<Truncate
								as="div"
								style={R.meta}
								testId="firmware-row-licence"
								text={`Licensed to ${row.local.receipt.licensee}${term ? ` · ${expired ? "ended" : "until"} ${term}` : ""} · ${shortFolder(row.folder)}`}
							/>
						) : null}
						<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
							{row.state === "flash" && (
								<>
									<button
										data-focal={focal ? "yes" : undefined}
										onClick={() =>
											onFlash(
												flashPrompt({
													title: e.title,
													version: e.version,
													licensee: row.local?.receipt.licensee ?? "this account",
													folder: row.folder,
													files: (row.local?.receipt.artifacts ?? e.artifacts).map((a) => a.path),
													family: e.family ?? row.local?.receipt.family,
													expiredOn: expired ? term : undefined,
													unitRoute: routeFor(row.folder),
												}),
												flashTitle({ title: e.title, version: e.version }),
											)
										}
										style={lead}
										type="button">
										Flash v{e.version}
										{unitDoor && routeFor(row.folder) ? ` ${unitDoor}` : ""}
									</button>
									<button
										onClick={() => void call({ op: "open-folder", folder: row.folder })}
										style={R.pill()}
										type="button">
										Open folder
									</button>
								</>
							)}
							{row.state === "download" && confirm !== row && (
								<button
									data-focal={focal ? "yes" : undefined}
									disabled={busy === key}
									onClick={() => setConfirm(row)}
									style={lead}
									type="button">
									{busy === key ? "downloading…" : row.local ? "Download again" : `Download v${e.version}`}
								</button>
							)}
							{row.state === "register" && (
								<button data-focal={focal ? "yes" : undefined} onClick={onRegister} style={lead} type="button">
									Register, free
								</button>
							)}
							{row.state === "renew" && (
								<button onClick={onRenew} style={R.pill()} type="button">
									Ask to renew
								</button>
							)}
							{row.state === "ask" && (
								<button data-focal={focal ? "yes" : undefined} onClick={onAsk} style={lead} type="button">
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
								<div style={{ ...R.body, display: "flex", gap: 6, alignItems: "flex-start" }}>
									<span>
										Download{" "}
										<b>
											{e.title} v{e.version}
										</b>{" "}
										into <code style={{ fontSize: 11 }}>{shortFolder(row.folder)}</code>
										{shortFolder(row.folder) !== row.folder ? " in this workspace" : ""}, with its licence and
										a receipt beside it.
									</span>
									<Info text="Your account is checked on the server now, not from a cached copy, and each file is checked against its hash before it is kept. The agent is told the path and the licence, never the bytes." />
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
		</div>
	)
}

export default FirmwareRungs
