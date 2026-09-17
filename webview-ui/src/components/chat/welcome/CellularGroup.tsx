import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CYAN_TEXT } from "../brandColors"
import { cardAction, entryRunStart, gateShown } from "./entryTelemetry"
import GatePanel from "./GatePanel"
import GatewayLadder, { ladderBoard } from "./GatewayLadder"
import IntentCard from "./IntentCard"
import RequestAccessForm from "./RequestAccessForm"
import { type IntentActionHandlers, runIntent } from "./runIntent"
import {
	ASK_FOR_DETAILS,
	blg20InstallPrompt,
	CELLULAR_INTENTS,
	cellularHint,
	type IntentDef,
	isRequestOnlyGroup,
} from "./welcomeIntents"

/**
 * "Cellular & gateways" — the group that asks for a free account.
 *
 * Free stays free. BLE, Wi-Fi and Ethernet are untouched by anything in this file; what registering
 * opens is the advanced cellular and edge-AI knowledge and the Fanstel demo hexes. The group is
 * always rendered, locked or live, because a card you cannot see is not an offer — and the developer
 * has to be able to read what they would get before deciding it is worth an account.
 *
 * The lock here is presentation. Enforcement is the registry's: every gated bit is refused server
 * side, so an edited panel shows four unlocked pictures and still gets a 402 on the first fetch.
 */

interface CellularGroupProps extends IntentActionHandlers {
	/** Board names already detected — a hint earns its line only when it names one of them. */
	boards?: readonly string[]
	/** Rendered under the LEW840x card once registered (the source request states). */
	gatewaySubline?: React.ReactNode
}

const CellularGroup: React.FC<CellularGroupProps> = ({ boards = [], gatewaySubline, ...handlers }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const [gate, setGate] = useState<{ intent: string } | null>(null)
	const [requesting, setRequesting] = useState<string | null>(null)

	const isLocked = (intent: IntentDef) => !accountHasGroup(adsumAccount, intent.group)
	// The note and the hint both say "register", so both are keyed on NOT BEING SIGNED IN — not on
	// whether some card is still locked. A developer who has an account and is missing one group is
	// not looking at a card registering will open, and telling them "free account, no card" there
	// would be an instruction that does nothing.
	const anonymous = !adsumAccount
	const hint = anonymous ? cellularHint(boards) : undefined
	/*
	 * With the board on the desk, the flat card for it becomes the LADDER: one card, three ways, and
	 * which one is already theirs. The card is not shown as well as the ladder — it IS the ladder,
	 * in the same place in the same list, or a developer would meet the same board twice and have to
	 * work out whether the two offers were the same thing.
	 */
	const ladder = ladderBoard(boards)

	// The gate is open for ONE card. It has nothing left to ask the moment that card's group arrives —
	// which is what sign-in does, and is not the same as "this developer has an account" (W-02b).
	const gateIntent = gate ? CELLULAR_INTENTS.find((i) => i.id === gate.intent) : undefined
	const gateSatisfied = !!gateIntent && accountHasGroup(adsumAccount, gateIntent.group)

	const openGate = (intent: IntentDef) => {
		// Signed in and still locked means a BY-REQUEST group (the tier opens on registration), so
		// the honest door is the request form, not a register panel for someone already registered.
		if (adsumAccount || isRequestOnlyGroup(intent.group)) {
			cardAction("cellular", "ask", { intent: intent.id })
			setRequesting(intent.id === "blg20Gateway" ? "blg20" : "lew840x")
			return
		}
		gateShown("card", intent.id)
		setGate({ intent: intent.id })
	}

	return (
		<div className="flex w-full flex-col gap-2" data-testid="cellular-group">
			<div
				className="flex flex-wrap items-baseline gap-x-2"
				style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
				<span className="uppercase" style={{ letterSpacing: "0.08em" }}>
					Cellular &amp; gateways
				</span>
				{anonymous && <span data-testid="cellular-note">· free account · no card</span>}
			</div>
			{hint && (
				<div data-testid="cellular-hint" style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
					{hint}
				</div>
			)}
			{ladder && (
				<GatewayLadder
					boards={boards}
					onAsk={() => setRequesting("blg20")}
					onInstall={(way) => void handlers.onStartTask(blg20InstallPrompt(way))}
					onStart={() => {
						entryRunStart("blg20Gateway", "card")
						runIntent("blg20Gateway", handlers)
					}}
				/>
			)}
			{CELLULAR_INTENTS.map((intent) => {
				// The ladder already IS this board's card.
				if (ladder && intent.id === "blg20Gateway") {
					return null
				}
				const locked = isLocked(intent)
				return (
					<React.Fragment key={intent.id}>
						<IntentCard
							description={intent.description}
							icon={intent.icon}
							locked={locked}
							onClick={() => {
								entryRunStart(intent.id, "card")
								runIntent(intent.id, handlers)
							}}
							onLocked={() => openGate(intent)}
							/* One phrase for the one door: the pill, the sub-line under it and the row in the
							   transcript all say the same thing. "Register" survives only where registering
							   is what actually opens the card — never on a set a person opens by hand. */
							pill={
								locked
									? adsumAccount || isRequestOnlyGroup(intent.group)
										? ASK_FOR_DETAILS
										: "Register"
									: undefined
							}
							testId={`cellular-card-${intent.id}`}
							title={intent.title}
						/>
						{/* The template-source line belongs to the gateway card and reads as its sub-line, but it
					    is rendered as a sibling rather than inside it: the card IS a button, and a control
					    nested in a button is unreachable by keyboard and mis-announced by screen readers.
					    Same place, same words, same colour — one valid control instead of two broken ones. */}
						{!locked && SOURCE_FAMILY[intent.id] && (
							<SourceLine
								family={SOURCE_FAMILY[intent.id]}
								onRequest={() => {
									cardAction("source_line", "ask", { family: SOURCE_FAMILY[intent.id] })
									setRequesting(SOURCE_FAMILY[intent.id])
								}}
							/>
						)}
					</React.Fragment>
				)
			})}
			{gatewaySubline}
			<RequestAccessForm family={requesting ?? undefined} onClose={() => setRequesting(null)} open={requesting !== null} />
			<GatePanel
				email={adsumAccount?.email}
				onClose={() => setGate(null)}
				open={gate !== null}
				satisfied={gateSatisfied}
				surface="card"
				variant={adsumAccount && !adsumAccount.emailVerified ? "verify" : "default"}
			/>
		</div>
	)
}

/**
 * Which family's source rungs a card offers. A card that is not in here offers none — the map is
 * the statement, so adding a gateway without deciding what its source is cannot silently inherit
 * another family's.
 */
const SOURCE_FAMILY: Record<string, string> = {
	cellularGateway: "lew840x",
	blg20Gateway: "blg20",
}

/**
 * "Request template source access →", or the state of the request already made.
 *
 * Read from the account's open requests, which come from the server — so a request sent on another
 * machine shows here too, and one the operator has decided stops showing as pending on the next
 * refresh without anyone clicking anything.
 */
export const SourceLine: React.FC<{ onRequest: () => void; family?: string }> = ({ onRequest, family = "lew840x" }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	/*
	 * The group prefix is the family's own, read from the card, not the literal "lew840x" this
	 * line carried while there was one gateway. A BLG20 holder's rungs are blg20-ble-src and
	 * blg20-9151-src, and a check hard-coded to the other family would have shown them
	 * "request access" for source they already hold.
	 */
	const granted = !!adsumAccount?.groups.some((g) => g.startsWith(`${family}-`) && g.endsWith("-src"))
	const pending = (adsumAccount?.openRequests ?? []).includes(family)
	const style: React.CSSProperties = { fontSize: "11px", paddingLeft: "63px", marginTop: "-6px" }
	/*
	 * Two gateway cards can now show this line at once, and two elements with one test id is a
	 * rig that silently asserts about whichever came first. The historic id stays on the family
	 * that had it, so every existing test still names the thing it was written about.
	 */
	const testId = family === "lew840x" ? "source-line" : `source-line-${family}`
	if (granted) {
		return (
			<div data-testid={testId} style={{ ...style, color: "var(--vscode-descriptionForeground)" }}>
				Source: yours — it resolves in your next run
			</div>
		)
	}
	if (pending) {
		return (
			<div data-testid={testId} style={{ ...style, color: "var(--vscode-descriptionForeground)" }}>
				Asked today · we reply within a business day
			</div>
		)
	}
	return (
		<button
			data-testid={testId}
			onClick={onRequest}
			style={{ ...style, background: "none", border: "none", cursor: "pointer", color: BRAND_CYAN_TEXT, textAlign: "left" }}
			type="button">
			{ASK_FOR_DETAILS}
		</button>
	)
}

export default CellularGroup
