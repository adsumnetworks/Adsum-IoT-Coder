import { type Blg20Unit, blg20Label } from "@shared/blg20"
import type { NrfEnvironment } from "@shared/nrf"
import { StringRequest } from "@shared/proto/cline/common"
import type React from "react"
import { createContext, useContext, useState } from "react"
import { AdsumServiceClient } from "@/services/grpc-client"
import Info from "../common/Info"
import { isPasskey, journeySteps, rowWords } from "./bleJourney"
import { R } from "./railStyles"

/** What the host's Bluetooth op answers: the step's outcome in the tool's own words. */
export interface BleReply {
	ok?: boolean
	words?: string
	error?: string
}
export type BleCall = (req: Record<string, unknown>) => Promise<BleReply>

const hostCall: BleCall = async (req) => {
	const r = await AdsumServiceClient.bluetooth(StringRequest.create({ value: JSON.stringify(req) }))
	return JSON.parse(r.value || "{}") as BleReply
}

/** The host's Bluetooth op, replaceable so a story can draw every state with no host behind it. */
export const BleCallContext = createContext<BleCall>(hostCall)

interface Props {
	/** The units in Bluetooth range (the picked one first, the host orders them). */
	units: Blg20Unit[]
	scan?: NrfEnvironment["bleScan"]
	platform?: string
	/** The family the firmware check compares against: the unit's own. */
	onAfter?: () => void
	/** The commissioning step's action: a session with its first line written (the conversation is the form). */
	onCommission?: (u: Blg20Unit) => void
}

/**
 * [11 Oct 2026] Gateways in range, on the Hardware page: the journey the operator asked for, before any session.
 * Scan finds them; the picked one leads the desk; Connect pairs the first time (the computer's dialog, or the six
 * digits on Linux) and reads the passport; Claim is the one write and asks first; Check firmware compares both
 * halves with the latest release and proposes the upgrade, which the Flash row below carries out. Every outcome is
 * the tool's own sentence under the row, never a verdict of the page.
 */
const BleGateways: React.FC<Props> = ({ units, scan, platform, onCommission }) => {
	const call = useContext(BleCallContext)
	const [busy, setBusy] = useState<string | null>(null)
	const [note, setNote] = useState<Record<string, string>>({})
	const [passkey, setPasskey] = useState<Record<string, string>>({})
	const [confirmClaim, setConfirmClaim] = useState<string | null>(null)
	const linux = platform === "linux"

	const run = async (key: string, req: Record<string, unknown>) => {
		setBusy(key)
		try {
			const r = await call(req)
			setNote((n) => ({ ...n, [key.split(":")[0]]: r.words ?? r.error ?? (r.ok ? "done" : "no answer") }))
		} catch (e) {
			setNote((n) => ({ ...n, [key.split(":")[0]]: e instanceof Error ? e.message : String(e) }))
		} finally {
			setBusy(null)
		}
	}
	const scanning = busy === "scan"
	return (
		<div data-testid="ble-gateways" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<div style={{ ...R.label, display: "flex", alignItems: "center", gap: 6 }}>
				Gateways in range
				<Info text="Over Bluetooth, the LBG20x's service port (its USB-C carries power only) and the BLG20x's second one. A unit shows while its commissioning window is open: at power-up, or after its button is held for three seconds. Connect pairs the first time and reads what the unit is and how it is commissioned; Claim makes this computer's key its owner key; Check firmware compares both halves with the latest release. Commission opens a session that asks one question at a time." />
				<span style={{ flex: 1 }} />
				<button
					data-testid="ble-scan"
					disabled={scanning}
					onClick={() => void run("scan", { op: "scan" })}
					style={R.pill()}
					type="button">
					{scanning ? "scanning…" : "Scan"}
				</button>
			</div>
			{scan?.error ? <div style={{ ...R.meta, color: "var(--vscode-errorForeground)" }}>{scan.error}</div> : null}
			{note.scan && note.scan !== scan?.error ? <div style={R.meta}>{note.scan}</div> : null}
			{/* A scan that could not run says why above; "power one up" would send the developer to the wrong fix. */}
			{units.length === 0 && !scan?.error ? (
				<div style={R.meta}>
					{scan
						? "No gateway in range: power one up, or hold its button for three seconds, then Scan."
						: "Not scanned yet."}
				</div>
			) : null}
			{units.map((u, i) => {
				const id = u.bleId ?? u.name ?? u.bleAddress ?? String(i)
				const label = blg20Label(u)
				const steps = journeySteps(u, platform)
				const pk = passkey[id] ?? ""
				return (
					<div
						data-testid="ble-gateway-row"
						key={id}
						style={{
							border: `1px solid ${i === 0 ? "var(--adsum-cyan)" : "color-mix(in srgb, var(--vscode-foreground) 14%, transparent)"}`,
							borderRadius: 8,
							padding: "8px 10px",
							display: "flex",
							flexDirection: "column",
							gap: 4,
							opacity: u.windowOpen === false ? 0.75 : 1,
						}}>
						<label style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8, cursor: "pointer" }}>
							<input
								aria-label={`Work with ${label}`}
								checked={i === 0}
								data-testid="ble-gateway-pick"
								name="ble-gateway"
								onChange={() => void run(`select:${id}`, { op: "select", target: id })}
								type="radio"
							/>
							<span style={R.title}>{label}</span>
							<span style={R.meta}>{rowWords(u)}</span>
						</label>
						<ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
							{steps.map((s) => (
								<li key={s.id} style={R.meta}>
									{s.done ? <span>{s.done}</span> : null}
									{s.info ? (
										<span style={{ marginLeft: 4 }}>
											<Info text={s.info} />
										</span>
									) : null}
									{s.blocked && !s.done ? <span>{s.blocked}</span> : null}
									{s.blocked && s.done ? <span> · {s.blocked}</span> : null}
									{s.passkeyHint ? <span data-testid="ble-passkey-hint">{s.passkeyHint} · </span> : null}
									{s.action && !s.blocked ? (
										<span
											style={{
												display: "inline-flex",
												gap: 6,
												alignItems: "center",
												marginLeft: s.done ? 6 : 0,
											}}>
											{s.needsPasskey ? (
												<input
													aria-label="The six digits on the unit's label"
													data-testid="ble-passkey"
													inputMode="numeric"
													maxLength={6}
													onChange={(e) => setPasskey((p) => ({ ...p, [id]: e.target.value }))}
													placeholder="six digits on its label"
													style={{
														width: 120,
														font: "inherit",
														fontSize: 11,
														padding: "2px 6px",
														background: "var(--vscode-input-background)",
														color: "var(--vscode-input-foreground)",
														border: "1px solid var(--vscode-input-border, transparent)",
														borderRadius: 4,
													}}
													value={pk}
												/>
											) : null}
											{s.id === "claim" && confirmClaim === id ? (
												<span
													style={{
														display: "inline-flex",
														gap: 6,
														alignItems: "center",
														flexWrap: "wrap",
													}}>
													<span>
														This computer's key becomes the unit's owner key, the only key that opens
														it.
													</span>
													<button
														data-testid="ble-claim-yes"
														disabled={!!busy}
														onClick={() => {
															setConfirmClaim(null)
															void run(`claim:${id}`, { op: "claim", target: id })
														}}
														style={R.pill("pri")}
														type="button">
														Claim it
													</button>
													<button onClick={() => setConfirmClaim(null)} style={R.pill()} type="button">
														Not now
													</button>
												</span>
											) : (
												<button
													data-testid={`ble-step-${s.id}`}
													disabled={!!busy || (s.needsPasskey && !isPasskey(pk))}
													onClick={() => {
														if (s.id === "claim") {
															setConfirmClaim(id)
															return
														}
														if (s.id === "commission") {
															onCommission?.(u)
															return
														}
														const req =
															s.id === "connect"
																? {
																		op: "connect",
																		target: id,
																		...(s.needsPasskey ? { passkey: pk.trim() } : {}),
																	}
																: { op: "check", target: id, family: u.family ?? "lbg20x" }
														void run(`${s.id}:${id}`, req)
													}}
													style={s.done && !s.primary ? R.pill() : R.pill("pri")}
													type="button">
													{busy === `${s.id}:${id}` ? "working…" : s.action}
												</button>
											)}
										</span>
									) : null}
								</li>
							))}
						</ol>
						{note[id.split(":")[0]] || u.words ? (
							<div data-testid="ble-gateway-words" style={R.meta}>
								{u.words ?? note[id]}
							</div>
						) : null}
						{(u.paired || u.bonded) && !linux && platform !== "win32" ? null : (
							<div>
								{u.paired || u.bonded ? (
									<button
										data-testid="ble-forget"
										disabled={!!busy}
										onClick={() => void run(`forget:${id}`, { op: "forget", target: id })}
										style={R.link}
										type="button">
										Forget pairing
									</button>
								) : null}
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}

export default BleGateways
