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

/**
 * The words on the card, in one place so their LENGTH is a testable property.
 *
 * A developer with the board on the desk reads this to answer one question — what can I do in the
 * next minute — and the first draft answered it in two paragraphs per rung, which at panel width
 * pushed the demo button below the fold. Each rung is now a title, one plain line, and one action.
 * The words kept are the ones that carry a commitment: Free, Registered, Licensed, "Limited use for
 * demos", "Ask for more details", "We reply within a business day". The rest were ours enjoying
 * themselves.
 *
 * The budget is 60 characters, measured and not guessed: at 269 px the body column is about 200 px
 * wide, which is roughly 30 characters of the 12 px face, so two lines is 60. The rendered heights
 * are printed beside every narrow shot, and that is what the number is calibrated against.
 */
export const LADDER_COPY = {
	question: "How do you want the firmware?",
	build: "Board, chips, programming recipe, the traps.",
	advanced: "Advanced set: on request",
	license: "Our build for this board, verified and signed.",
	demoTerms: "Limited use for demos",
	production: "Our build for the units you ship.",
	source: "Our firmware's source, one half or both.",
	/** Held, whichever halves: what arrives, once. Which halves is on the heading, not repeated here. */
	sourceHeld: "Generated into your project, never a repository.",
	built: "Tell us what it must do, how many, by when.",
	reply: "We reply within a business day.",
	after: "Program each half with your own probe.",
} as const

/** Boards this ladder is about, when something actually prints the product's name. */
export const LADDER_BOARDS = /blg20|lbg20/i

/**
 * The two chips this gateway IS, matched on what the hardware reports about itself.
 *
 * Nothing prints "BLG20x". On a real bench the probes enumerate their targets — `nRF54LM20B` and
 * `nRF9151` — while the board list shows the development kit each probe belongs to, so a name test
 * finds nothing and the owner of the actual board sees no ladder at all. The chips are the honest
 * signal: they are what the silicon answers when asked.
 *
 * BOTH, or nothing. One alone is not this board: an nRF9151 by itself is a cellular kit and an
 * nRF54 by itself is a BLE kit, and either could sit on a desk for a completely different reason.
 * Requiring the pair is what keeps the card from claiming a product nobody has.
 */
const LADDER_CHIP_A = /nrf54l/i
const LADDER_CHIP_B = /nrf91(51|61|60)?/i

export const ladderBoard = (boards: readonly string[]): string | undefined => boards.find((b) => LADDER_BOARDS.test(b))

/** The pair, when both are present in the same environment. Returns the two names, in order seen. */
export const ladderChipPair = (chips: readonly string[]): [string, string] | undefined => {
	const a = chips.find((c) => LADDER_CHIP_A.test(c))
	const b = chips.find((c) => LADDER_CHIP_B.test(c))
	return a && b ? [a, b] : undefined
}

interface GatewayLadderProps {
	/** Board names the environment has actually seen. */
	boards?: readonly string[]
	/** Chip identities the probes reported — what the silicon says it is. */
	chips?: readonly string[]
	/** Starts the free path in the editor. */
	onStart: () => void
	/** Opens the request form for this family, for anything not already theirs. */
	onAsk: (rung: string) => void
	/** Runs the way the developer already holds — only ever offered for a way they hold. */
	onInstall: (way: "demo" | "production" | "source") => void
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

/**
 * "yours" — the marker on a rung the account holds.
 *
 * A word, not a sentence: the glance question is "which of these is already mine", and a chip answers
 * it where the eye already is. It appears ONLY on a rung actually held, which is the same rule the
 * falsifiers hold for the prose.
 */
const Yours: React.FC = () => (
	<span
		data-testid="ladder-yours"
		style={{
			marginLeft: "7px",
			fontSize: "10px",
			letterSpacing: "0.04em",
			padding: "1px 6px",
			borderRadius: "99px",
			color: BRAND_CYAN_TEXT,
			border: `1px solid ${brandAlpha(BRAND_CYAN_TEXT, 0.5)}`,
		}}>
		yours
	</span>
)

/** The action for a way the developer already holds. Cyan, like every other doing action. */
const Doing: React.FC<{ label: string; onClick: () => void; testId: string }> = ({ label, onClick, testId }) => (
	<button
		data-testid={testId}
		onClick={onClick}
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
		{label}
	</button>
)

const GatewayLadder: React.FC<GatewayLadderProps> = ({ boards = [], chips = [], onStart, onAsk, onInstall, onBrowse }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const board = ladderBoard(boards)
	const pair = board ? undefined : ladderChipPair(chips)
	// No name and no pair, no ladder. A surface that names a board must have seen one.
	if (!board && !pair) {
		return null
	}
	/*
	 * Every rung reads the SAME group facts the rest of the surface reads. Before this the card knew
	 * only whether the demo was held, so a licence holder was invited to "Ask for more details" about
	 * the thing they had already bought — the partner card and the holder-of-everything card were
	 * byte-identical screenshots.
	 */
	const holds = (group: string) => accountHasGroup(adsumAccount, group)
	const hasDemo = holds("blg20-demo-hex")
	const hasProduction = holds("blg20-prod-hex")
	const hasRadioSource = holds("blg20-9151-src")
	const hasBleSource = holds("blg20-ble-src")
	const hasAnySource = hasRadioSource || hasBleSource
	const hasBothSource = hasRadioSource && hasBleSource
	// "On request" is an invitation. Sending it to someone who already holds the set is the same
	// mistake as the Register button, so the line simply is not there for them.
	const hasAdvanced = holds("blg20-adv-ble") || holds("blg20-adv-full")
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
				{/*
				 * Named board, or the evidence. Seeing the two chips is not proof someone owns this
				 * product — they might be two kits on one desk — so when that is all we have, the line
				 * says what was seen and lets the reader draw the conclusion.
				 */}
				{board ? "Your board: " : "Seen here: "}
				<span data-testid="ladder-board" style={{ color: "var(--vscode-foreground)" }}>
					{board ?? `${pair?.[0]} and ${pair?.[1]} — the BLG20x pair`}
				</span>
				{/*
				 * The mockup's "· both probes seen" is not here, and will not be until something counts
				 * probes. The environment reports Nordic BOARDS, not the debug probes attached to them,
				 * and a number that is not measured is absent — a card that claims to have seen two
				 * probes when it counted something else is worse than a card that claims nothing.
				 */}
			</div>
			<div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--vscode-foreground)", margin: "6px 0 2px" }}>
				{LADDER_COPY.question}
			</div>

			<Rung badge="Free" icon="tools" testId="ladder-rung-build" title="Build it yourself">
				<Body>{LADDER_COPY.build}</Body>
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
				</div>
				{/* The advanced set is a line, not a pitch — and no line at all for someone who holds it. */}
				{!hasAdvanced && (
					<div
						data-testid="ladder-advanced-line"
						style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap", marginTop: "6px" }}>
						<span style={{ fontSize: "12px", color: "var(--vscode-foreground)" }}>{LADDER_COPY.advanced}</span>
						<Ask onClick={() => onAsk("adv")} testId="ladder-ask-adv" />
					</div>
				)}
			</Rung>

			<Rung
				badge={hasDemo ? "Demo included" : "Licensed"}
				icon="verified"
				testId="ladder-rung-license"
				title="License ours">
				<Body>{LADDER_COPY.license}</Body>
				<div style={{ marginTop: "7px", display: "flex", flexDirection: "column", gap: "8px" }}>
					<div data-testid="ladder-way-demo">
						<div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
							<span style={{ fontSize: "12px", color: "var(--vscode-foreground)" }}>Demo</span>
							{hasDemo && <Yours />}
							<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
								{LADDER_COPY.demoTerms}
							</span>
							{hasDemo ? null : <Ask onClick={() => onAsk("demo")} testId="ladder-ask-demo" />}
						</div>
						{hasDemo && (
							<button
								data-testid="ladder-flash-demo"
								onClick={() => onInstall("demo")}
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
								Install into this project
							</button>
						)}
					</div>
					<div data-testid="ladder-way-production">
						<div style={{ fontSize: "12px", color: "var(--vscode-foreground)" }}>
							Production licence
							{hasProduction && <Yours />}
						</div>
						<Body>{LADDER_COPY.production}</Body>
						{hasProduction ? (
							<Doing
								label="Install into this project"
								onClick={() => onInstall("production")}
								testId="ladder-use-prod"
							/>
						) : (
							<Ask onClick={() => onAsk("prod-hex")} testId="ladder-ask-prod" />
						)}
					</div>
					<div data-testid="ladder-way-source">
						<div style={{ fontSize: "12px", color: "var(--vscode-foreground)" }}>
							Source licence
							{hasBothSource
								? " · both halves"
								: hasRadioSource
									? " · the radio half"
									: hasBleSource
										? " · the BLE half"
										: ""}
							{hasAnySource && <Yours />}
						</div>
						<Body>{hasAnySource ? LADDER_COPY.sourceHeld : LADDER_COPY.source}</Body>
						{hasAnySource && (
							<Doing
								label="Install into this project"
								onClick={() => onInstall("source")}
								testId="ladder-use-source"
							/>
						)}
						{/* One half held is still half asked-about: the other half is a real thing to ask for. */}
						{!hasBothSource && <Ask onClick={() => onAsk("both-src")} testId="ladder-ask-source" />}
					</div>
				</div>
			</Rung>

			<Rung badge="By arrangement" icon="edit" testId="ladder-rung-built" title="Have it built">
				<Body>{LADDER_COPY.built}</Body>
				<div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
					<Ask onClick={() => onAsk("built")} testId="ladder-ask-built" />
					<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>{LADDER_COPY.reply}</span>
				</div>
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
