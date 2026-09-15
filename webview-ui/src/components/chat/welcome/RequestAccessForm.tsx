import type { AdsumAccountState } from "@shared/adsumAccount"
import { StringRequest } from "@shared/proto/cline/common"
import React, { useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AdsumServiceClient } from "@/services/grpc-client"
import { BRAND_CYAN_UI } from "../brandColors"

/**
 * "Ask for more details" — the one door to everything a free account does not open, under the one
 * name the rest of the product uses for it.
 *
 * It is a form and not a button because the answer depends on what they are building: a pilot of a
 * hundred units and a hobby port get different answers, and asking here is cheaper for both sides
 * than a refusal later. Never "open source": these templates are licensed source, and calling them
 * anything else would be a promise we cannot keep.
 *
 * One open request per family, enforced by the database's partial unique index — so two tabs cannot
 * open two, and the second is told which case it hit rather than shown a generic failure.
 */

export const FAMILIES = [
	{ id: "lew840x", label: "Fanstel LEW840x" },
	{ id: "blg20", label: "Fanstel BLG20" },
] as const

/**
 * What a family can be asked for, per family.
 *
 * Per family and not one list, because the chips are the real silicon: a BLG20's BLE half is an
 * nRF54 and its cellular half an nRF9151, and offering "nRF9160" against a board that does not
 * carry one files a request nobody can grant. The ids are the group suffixes the steward acts on,
 * so a label may be rewritten freely and an id may not.
 */
export const CHIPS_BY_FAMILY = {
	/*
	 * [15 Sep 2026] The BLE scanner source and the ESP32 application without the cellular rung are free,
	 * as their prebuilt images are, so they are no longer something to ask for. The one LEW840x source a
	 * person asks for is the full tree with the cellular rung — the nRF9160 modem project and the ESP32
	 * application that drives it. The id is the group suffix the steward acts on and stays as it was.
	 */
	lew840x: [{ id: "9160-src", label: "Full source, with the cellular rung (nRF9160 + ESP32)" }],
	/*
	 * The BLG20x list is the WAYS, not the parts. The demo pair is included with a registered
	 * account, so offering it here would file a request for something the developer already has —
	 * and the two images are not "chips" and the knowledge set is not "source", which is why the
	 * field above them no longer says either word.
	 */
	blg20: [
		{ id: "prod-hex", label: "Production licence" },
		{ id: "9151-src", label: "Source for the radio half (cellular and satellite)" },
		{ id: "both-src", label: "Source for both halves" },
		{ id: "adv", label: "The advanced knowledge set" },
	],
} as const

/** The list for a family, and never an empty one: an unknown family falls back to the first. */
export const chipsFor = (family: string): ReadonlyArray<{ id: string; label: string }> =>
	CHIPS_BY_FAMILY[family as keyof typeof CHIPS_BY_FAMILY] ?? CHIPS_BY_FAMILY[FAMILIES[0].id]

/** The historic export, kept so nothing that imports it breaks: the LEW840x list. */
export const CHIPS = CHIPS_BY_FAMILY.lew840x

export type RequestState = "none" | "sent" | "granted"

interface RequestAccessFormProps {
	open: boolean
	onClose: () => void
	/** Told when a request lands, so the card sub-line and the Account tab can say so at once. */
	onSent?: (family: string) => void
	/** Pre-selects the family when the form is opened from a specific card. */
	family?: string
}

const NEUTRAL_EDGE = "color-mix(in srgb, var(--vscode-foreground) 22%, transparent)"

const RequestAccessForm: React.FC<RequestAccessFormProps> = ({ open, onClose, onSent, family: initialFamily }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const [family, setFamily] = useState<string>(initialFamily ?? FAMILIES[0].id)
	const [chips, setChips] = useState<string[]>([])

	/*
	 * A selection made for one family is meaningless in another - an ESP entry against a BLG20 is a
	 * request nobody can answer - so changing the family clears the selection rather than carrying
	 * the old ids across. It clears to NOTHING and never to a default: a pre-ticked box asks on the
	 * developer's behalf for something they did not choose, and the first entry of a list is not a
	 * guess worth making.
	 */
	useEffect(() => {
		setChips([])
	}, [family])
	const [message, setMessage] = useState("")
	const [sending, setSending] = useState(false)
	const [sent, setSent] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const dialogRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) {
			return
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation()
				onClose()
			}
		}
		window.addEventListener("keydown", onKey, true)
		dialogRef.current?.querySelector<HTMLElement>("select, button")?.focus()
		return () => window.removeEventListener("keydown", onKey, true)
	}, [open, onClose])

	if (!open) {
		return null
	}

	const toggle = (chip: string) => setChips((prev) => (prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]))

	const send = async () => {
		setSending(true)
		setError(null)
		try {
			const res = await AdsumServiceClient.requestAccess(
				StringRequest.create({ value: JSON.stringify({ family, chips, message }) }),
			)
			const out = JSON.parse(res.value || "{}") as { ok?: boolean; reason?: string }
			if (out.ok) {
				setSent(true)
				onSent?.(family)
			} else {
				setError(
					out.reason === "already_open"
						? "You already have an open request for this family — we are still on it."
						: out.reason === "unknown_option"
							? "That option is not one we can grant on this family. Your request has not been sent."
							: out.reason === "offline"
								? "Adsum can’t be reached right now. Your request has not been sent."
								: "That didn’t send. Try again in a moment.",
				)
			}
		} catch {
			setError("That didn’t send. Try again in a moment.")
		} finally {
			setSending(false)
		}
	}

	const familyLabel = FAMILIES.find((f) => f.id === family)?.label ?? family

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the scrim is a dismissal affordance; Esc is handled above.
		<div
			data-testid="request-scrim"
			onClick={onClose}
			style={{
				// fixed, not absolute: this modal is opened from the welcome surface AND from a row deep in
				// a scrolled transcript, and an absolute scrim there anchors to whatever happens to be
				// positioned above it — which is how a modal ends up half off-screen.
				position: "fixed",
				inset: 0,
				background: "color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)",
				backdropFilter: "blur(2px)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "16px",
				zIndex: 40,
			}}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: stops the scrim's dismissal, no behaviour of its own. */}
			<div
				aria-modal="true"
				data-testid="request-form"
				onClick={(e) => e.stopPropagation()}
				ref={dialogRef}
				role="dialog"
				style={{
					width: "100%",
					maxWidth: "400px",
					background: "var(--vscode-editor-background)",
					border: `1px solid ${NEUTRAL_EDGE}`,
					borderRadius: "12px",
					padding: "18px 18px 16px",
					position: "relative",
					boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
				}}>
				<button
					aria-label="Close"
					data-testid="request-close"
					onClick={onClose}
					style={{
						position: "absolute",
						top: "10px",
						right: "10px",
						background: "none",
						border: "none",
						cursor: "pointer",
						color: "var(--vscode-descriptionForeground)",
						fontSize: "15px",
						lineHeight: 1,
						padding: "2px 6px",
					}}
					type="button">
					×
				</button>

				{sent ? (
					<>
						<Title>Request sent</Title>
						<Lead>
							We reply within a business day to{" "}
							<b style={{ color: "var(--vscode-foreground)" }}>{adsumAccount?.email}</b>. The{" "}
							{familyLabel.replace("Fanstel ", "")} card will say so when it is yours.
						</Lead>
						<Row>
							<Secondary onClick={onClose} testId="request-done">
								Done
							</Secondary>
						</Row>
					</>
				) : (
					<>
						<Title>Ask for more details</Title>
						{/* One line: what to do. The old lead explained our licensing before asking the
						    question, which is our concern and not the reader's at this moment. */}
						<Lead>Tell us what you are building. These are licensed source; we will say what covers it.</Lead>
						<Field label="Gateway family">
							<select
								data-testid="request-family"
								onChange={(e) => setFamily(e.target.value)}
								style={inputStyle}
								value={family}>
								{FAMILIES.map((f) => (
									<option key={f.id} value={f.id}>
										{f.label}
									</option>
								))}
							</select>
						</Field>
						<Field label="What you are asking about">
							<div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
								{chipsFor(family).map((c) => (
									<label
										key={c.id}
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: "5px",
											fontSize: "12px",
											color: "var(--vscode-foreground)",
										}}>
										<input
											checked={chips.includes(c.id)}
											data-testid={`request-chip-${c.id}`}
											onChange={() => toggle(c.id)}
											type="checkbox"
										/>
										{c.label}
									</label>
								))}
							</div>
						</Field>
						<Field label="What are you building?">
							<textarea
								data-testid="request-message"
								onChange={(e) => setMessage(e.target.value)}
								placeholder="A few lines is enough — product, volume, when you need it."
								rows={3}
								style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
								value={message}
							/>
						</Field>
						{error && (
							<div data-testid="request-error" style={{ fontSize: "11px", color: "var(--vscode-errorForeground)" }}>
								{error}
							</div>
						)}
						<Row>
							<button
								data-testid="request-send"
								disabled={sending || chips.length === 0}
								onClick={send}
								style={{
									padding: "6px 12px",
									borderRadius: "6px",
									fontSize: "12px",
									fontWeight: 600,
									cursor: sending || chips.length === 0 ? "default" : "pointer",
									border: `1px solid ${BRAND_CYAN_UI}`,
									background: BRAND_CYAN_UI,
									color: "#04222b",
									opacity: sending || chips.length === 0 ? 0.6 : 1,
								}}
								type="button">
								{sending ? "Sending…" : "Send request"}
							</button>
							<Ghost onClick={onClose}>Cancel</Ghost>
						</Row>
						<Fine>Sent as {adsumAccount?.email} · one open request per family.</Fine>
					</>
				)}
			</div>
		</div>
	)
}

const inputStyle: React.CSSProperties = {
	width: "100%",
	fontSize: "12px",
	padding: "5px 7px",
	borderRadius: "5px",
	border: `1px solid ${NEUTRAL_EDGE}`,
	background: "var(--vscode-input-background)",
	color: "var(--vscode-foreground)",
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
	<div style={{ marginTop: "11px" }}>
		<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginBottom: "4px" }}>{label}</div>
		{children}
	</div>
)
const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ fontSize: "14px", fontWeight: 600, color: "var(--vscode-foreground)", marginBottom: "5px" }}>{children}</div>
)
const Lead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" }}>{children}</div>
)
const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ display: "flex", gap: "8px", marginTop: "13px", alignItems: "center" }}>{children}</div>
)
const Fine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ fontSize: "10.5px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)", marginTop: "10px" }}>
		{children}
	</div>
)
const Secondary: React.FC<{ children: React.ReactNode; onClick: () => void; testId?: string }> = ({
	children,
	onClick,
	testId,
}) => (
	<button
		data-testid={testId}
		onClick={onClick}
		style={{
			padding: "6px 12px",
			borderRadius: "6px",
			fontSize: "12px",
			cursor: "pointer",
			border: `1px solid ${NEUTRAL_EDGE}`,
			background: "var(--vscode-input-background)",
			color: "var(--vscode-foreground)",
		}}
		type="button">
		{children}
	</button>
)
const Ghost: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => (
	<button
		onClick={onClick}
		style={{
			padding: "6px 10px",
			borderRadius: "6px",
			fontSize: "12px",
			cursor: "pointer",
			border: "none",
			background: "none",
			color: "var(--vscode-descriptionForeground)",
		}}
		type="button">
		{children}
	</button>
)

export default RequestAccessForm
