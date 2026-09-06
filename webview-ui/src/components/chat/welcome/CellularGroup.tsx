import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { entryRunStart, gateShown } from "./entryTelemetry"
import GatePanel from "./GatePanel"
import IntentCard from "./IntentCard"
import { type IntentActionHandlers, runIntent } from "./runIntent"
import { CELLULAR_INTENTS, cellularHint, type IntentDef } from "./welcomeIntents"

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
	/** Rendered under the LEW840x card once registered (the template-source request states). */
	gatewaySubline?: React.ReactNode
}

const CellularGroup: React.FC<CellularGroupProps> = ({ boards = [], gatewaySubline, ...handlers }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const [gate, setGate] = useState<{ intent: string } | null>(null)

	const isLocked = (intent: IntentDef) => !accountHasGroup(adsumAccount, intent.group)
	// The note and the hint both say "register", so both are keyed on NOT BEING SIGNED IN — not on
	// whether some card is still locked. A developer who has an account and is missing one group is
	// not looking at a card registering will open, and telling them "free account, no card" there
	// would be an instruction that does nothing.
	const anonymous = !adsumAccount
	const hint = anonymous ? cellularHint(boards) : undefined

	const openGate = (intent: IntentDef) => {
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
			{CELLULAR_INTENTS.map((intent) => {
				const locked = isLocked(intent)
				return (
					<IntentCard
						description={intent.description}
						icon={intent.icon}
						key={intent.id}
						locked={locked}
						onClick={() => {
							entryRunStart(intent.id, "card")
							runIntent(intent.id, handlers)
						}}
						onLocked={() => openGate(intent)}
						pill={locked ? "Register" : undefined}
						testId={`cellular-card-${intent.id}`}
						title={intent.title}
					/>
				)
			})}
			{gatewaySubline}
			<GatePanel
				email={adsumAccount?.email}
				onClose={() => setGate(null)}
				open={gate !== null}
				surface="card"
				variant={adsumAccount && !adsumAccount.emailVerified ? "verify" : "default"}
			/>
		</div>
	)
}

export default CellularGroup
