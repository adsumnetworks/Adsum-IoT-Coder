import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, BRAND_CYAN_TEXT, BRAND_CYAN_UI, brandAlpha } from "../brandColors"
import { ASK_FOR_DETAILS } from "./welcomeIntents"

/**
 * How do you want the firmware? — the three ways, on one card.
 *
 * ONE card and three rungs, never three cards. Three cards would read as three unrelated offers and
 * leave the developer to work out that they are alternatives; the whole point of the surface is that
 * a person with this board on the desk can see the ways side by side and tell which one is already
 * theirs. What shipped before this was a flat list of run cards where the ways did not appear at all.
 *
 * The rules the copy obeys, and the tests hold: no prices, no licence terms, and the only tier words
 * are Free, Registered and Licensed. Everything a developer does not already have carries the one
 * action the rest of the product uses — "Ask for more details" — which files a request and writes
 * nothing to their account.
 */

/** Boards this ladder is about. A board outside it gets no ladder, not a wrong one. */
export const LADDER_BOARDS = /blg20|lbg20/i

export const ladderBoard = (boards: readonly string[]): string | undefined => boards.find((b) => LADDER_BOARDS.test(b))

interface GatewayLadderProps {
	/** Board names the environment has actually seen. */
	boards?: readonly string[]
	/** Starts the free path in the editor. */
	onStart: () => void
	/** Opens the request form for this family, for anything not already theirs. */
	onAsk: (rung: string) => void
	/** Installs the demo pair — only ever offered when the account holds it. */
	onFlashDemo: () => void
	/** Opens the hardware list, for someone whose board is not this one. */
	onBrowse?: () => void
}

const Rung: React.FC<{
	icon: string
	title: string
	badge: string
	testId: string
	children: React.ReactNode
}> = ({ icon, title, badge, testId, children }) => (
	<div
		data-testid={testId}
		style={{
			display: "flex",
			gap: "11px",
			padding: "13px 0",
			borderTop: "1px solid color-mix(in srgb, var(--vscode-foreground) 11%, transparent)",
		}}>
		<i
			className={`codicon codicon-${icon}`}
			style={{ fontSize: "14px", color: BRAND_CORAL, marginTop: "2px", width: "16px", flexShrink: 0 }}
		/>
		<div style={{ minWidth: 0, flex: 1 }}>
			<div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
				<span style={{ fontSize: "13px", fontWeight: 600, color: "var(--vscode-foreground)" }}>{title}</span>
				{/* The tier, in one word. Never a price, never what a licence covers. */}
				<span data-testid={`${testId}-badge`} style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
					{badge}
				</span>
			</div>
			{children}
		</div>
	</div>
)

const Body: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)", marginTop: "3px" }}>
		{children}
	</div>
)

const Ask: React.FC<{ label?: string; onClick: () => void; testId: string }> = ({ label, onClick, testId }) => (
	<button
		data-testid={testId}
		onClick={onClick}
		style={{
			background: "none",
			border: "none",
			padding: "3px 0 0",
			fontSize: "11.5px",
			cursor: "pointer",
			color: BRAND_CYAN_TEXT,
			textAlign: "left",
		}}
		type="button">
		{label ?? ASK_FOR_DETAILS}
	</button>
)

const GatewayLadder: React.FC<GatewayLadderProps> = ({ boards = [], onStart, onAsk, onFlashDemo, onBrowse }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const board = ladderBoard(boards)
	// No board of this family, no ladder. A surface that names a board must have seen one.
	if (!board) {
		return null
	}
	const hasDemo = accountHasGroup(adsumAccount, "blg20-demo-hex")
	return (
		<div
			data-testid="gateway-ladder"
			style={{
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.5)}`,
				background: "var(--vscode-input-background)",
				borderRadius: "10px",
				padding: "13px 14px 11px",
			}}>
			<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
				Your board:{" "}
				<span data-testid="ladder-board" style={{ color: "var(--vscode-foreground)" }}>
					{board}
				</span>
				{/*
				 * The mockup's "· both probes seen" is not here, and will not be until something counts
				 * probes. The environment reports Nordic BOARDS, not the debug probes attached to them,
				 * and a number that is not measured is absent — a card that claims to have seen two
				 * probes when it counted something else is worse than a card that claims nothing.
				 */}
			</div>
			<div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--vscode-foreground)", margin: "6px 0 2px" }}>
				How do you want the firmware?
			</div>

			<Rung badge="Free" icon="tools" testId="ladder-rung-build" title="Build it yourself">
				<Body>
					Everything you need to build a gateway on this board from scratch: the board, the two chips, the programming
					recipe, and the traps that cost us days.
				</Body>
				<Body>
					There is an advanced set too. It knows this hardware, so you build the full gateway from scratch much faster;
					and for a licence holder it knows the firmware, so you customise that much faster too. Provided on request.
				</Body>
				<div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginTop: "7px" }}>
					<button
						data-testid="ladder-start"
						onClick={onStart}
						style={{
							padding: "4px 11px",
							borderRadius: "6px",
							fontSize: "12px",
							fontWeight: 600,
							cursor: "pointer",
							border: `1px solid ${BRAND_CYAN_UI}`,
							background: BRAND_CYAN_UI,
							color: "#04222b",
						}}
						type="button">
						Start in the editor
					</button>
					<Ask label={`${ASK_FOR_DETAILS} — the advanced set`} onClick={() => onAsk("adv")} testId="ladder-ask-adv" />
				</div>
			</Rung>

			{/*
			 * "Demo included" and "the demo is yours now" are TRUE ONLY OF SOMEONE WHO HOLDS IT. This
			 * board's demo pair is granted per account, not by the tier, so a registered developer who
			 * has not been granted it was being told the demo was already theirs and then offered a
			 * request for it — the surface claiming ownership and the button denying it, one line apart.
			 */}
			<Rung
				badge={hasDemo ? "Demo included" : "Licensed"}
				icon="verified"
				testId="ladder-rung-license"
				title="License ours">
				<Body>
					Our build for this board, verified on it and signed.{" "}
					{hasDemo ? "The demo is yours now; ask about the other two." : "Ask about any of the three ways."}
				</Body>
				<div style={{ marginTop: "7px", display: "flex", flexDirection: "column", gap: "9px" }}>
					<div data-testid="ladder-way-demo">
						<div style={{ fontSize: "12px", color: "var(--vscode-foreground)" }}>
							Demo{" "}
							<span style={{ color: "var(--vscode-descriptionForeground)" }}>
								— included with a registered account
							</span>
						</div>
						<Body>Limited use for demos</Body>
						{hasDemo ? (
							<button
								data-testid="ladder-flash-demo"
								onClick={onFlashDemo}
								style={{
									marginTop: "5px",
									padding: "3px 10px",
									borderRadius: "6px",
									fontSize: "11.5px",
									fontWeight: 600,
									cursor: "pointer",
									border: `1px solid ${BRAND_CYAN_UI}`,
									background: BRAND_CYAN_UI,
									color: "#04222b",
								}}
								type="button">
								Flash the demo
							</button>
						) : (
							<Ask onClick={() => onAsk("demo")} testId="ladder-ask-demo" />
						)}
					</div>
					<div data-testid="ladder-way-production">
						<div style={{ fontSize: "12px", color: "var(--vscode-foreground)" }}>Production licence</div>
						<Body>Our verified build for the units you ship. Ask and we will tell you what it covers.</Body>
						<Ask onClick={() => onAsk("prod-hex")} testId="ladder-ask-prod" />
					</div>
					<div data-testid="ladder-way-source">
						<div style={{ fontSize: "12px", color: "var(--vscode-foreground)" }}>Source licence</div>
						<Body>
							The source of our firmware, for the radio half or for both halves, with the advanced knowledge to
							build on it and customise it fast.
						</Body>
						<Ask onClick={() => onAsk("both-src")} testId="ladder-ask-source" />
					</div>
				</div>
			</Rung>

			<Rung badge="By arrangement" icon="edit" testId="ladder-rung-built" title="Have it built">
				<Body>
					Tell us what the firmware has to do, how many units and by when. We come back with a lead time and a range,
					and what we build is delivered on this same ladder.
				</Body>
				<Ask onClick={() => onAsk("built")} testId="ladder-ask-built" />
				<Body>We reply within a business day.</Body>
			</Rung>

			{onBrowse && (
				<div
					style={{
						fontSize: "11px",
						paddingTop: "10px",
						borderTop: "1px solid color-mix(in srgb, var(--vscode-foreground) 11%, transparent)",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Not this board?{" "}
					<button
						data-testid="ladder-browse"
						onClick={onBrowse}
						style={{
							background: "none",
							border: "none",
							padding: 0,
							fontSize: "11px",
							cursor: "pointer",
							color: BRAND_CYAN_TEXT,
						}}
						type="button">
						Browse hardware
					</button>
				</div>
			)}
		</div>
	)
}

export default GatewayLadder
