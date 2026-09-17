import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import { demoPairServed } from "@shared/adsumDemoPairs"
import React, { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, BRAND_CYAN_UI, brandAlpha } from "../brandColors"
import { cardAction, cardShown } from "./entryTelemetry"
import { DEMO_HEX_PROMPT, DEMO_PAIR_PROMPT_BLG20 } from "./welcomeIntents"

/**
 * The demo a registered developer can actually run, for whichever board's demo they hold.
 *
 * Coral frame, because this is the identity moment: our hardware partner's board, our tagged builds.
 * It is the only card on this surface that puts bytes on a device, so it is the only one that earns
 * a coloured edge here.
 *
 * One card, a table of boards. It was one board hard-coded — the group, the title, the images and
 * the cap were all the LEW840x's — so an owner of the other board saw NOTHING: no card, no limits,
 * no statement of what protects the image, and no way to the demo except guessing a sentence into
 * the chat box. The limits are stated ABOVE the action, before anything is downloaded: a demo whose
 * limits are discovered afterwards is a demo that gets returned.
 *
 * [14 Sep 2026] Two more rules. The card shows only a pair the registry actually serves this account: the
 * LEW840x pair was withdrawn while every registered account was still offered it. And when an account holds
 * more than one pair, the board on the desk decides which card it sees, not the order of this table.
 */

/** One board's demo, in the words the developer reads. Adding a board is a row here, not a component. */
interface DemoPair {
	/** The group that says this developer holds it. */
	group: string
	/** The boards this pair is for, as the environment names them. Decides between pairs an account holds. */
	board: RegExp
	title: string
	/** What it costs, in tier words: Free, Registered, Licensed — never a price. */
	badge: string
	body: string
	/** Stated above the action. Short lines, each true of this board. */
	limits: readonly string[]
	action: string
	/** What happens after, in one line. */
	after: string
	/**
	 * The licence notice that now travels with every image, in one line.
	 *
	 * A sentence and not a link: the document it would point at does not exist yet, and a card is
	 * not where anyone reads licence text. It says the one operational fact — a notice is written
	 * next to the images — in the installer's own words, so the card, the bundle and the install agree.
	 */
	licence?: string
	/**
	 * What protects the image today, in the developer's words and not in ours. The same sentence
	 * appears in the bit's descriptor and on the datasheet's licence row; it is written once here so
	 * the three cannot drift apart.
	 */
	protection?: string
	prompt: string
	testId: string
}

const DEMO_PAIRS: readonly DemoPair[] = [
	{
		group: "lew840x-demo-hex",
		board: /lew840|ew840/i,
		title: "Flash the LEW840x demo",
		badge: "Demo included",
		body: "Three images: BLE scanner, ESP32 uplink, nRF9160 bearer. Needs nrfutil and esptool on this machine.",
		limits: ["Wi-Fi and Ethernet unlimited", "Cellular in 60-minute windows, for evaluation"],
		action: "Flash demo ▸",
		after: "≈ 3 min · you will be asked for the ports",
		licence: "A licence notice is written next to the images.",
		protection: "Today the demo bearer is protected by your account's access and a limit built into the image, nothing more.",
		prompt: DEMO_HEX_PROMPT,
		testId: "demo-hex-card",
	},
	{
		group: "blg20-demo-hex",
		board: /blg20|lbg20/i,
		title: "BLG20x demo pair",
		badge: "Demo included",
		body: "Two images, one for each half of the board, built from a tagged source.",
		limits: ["Limited use for demos", "Terrestrial and satellite"],
		action: "Install into this project",
		after: "Then program each half with your own probe. Take the serial number from the tool, never one you remember.",
		licence: "A licence notice is written next to the images.",
		protection:
			"Today the demo image is protected by your account's access and a usage cap built into the image, " +
			"nothing more. The production image is protected by account access only.",
		prompt: DEMO_PAIR_PROMPT_BLG20,
		testId: "demo-pair-card-blg20",
	},
]

interface DemoHexCardProps {
	/** Starts the run for the pair the developer holds. */
	onFlash: (prompt: string) => void | Promise<void>
	/** Which image is being written, e.g. "nRF9160 bearer… 2 of 3". Absent ⇒ idle. */
	flashing?: string
	/** The boards the environment has seen. Absent or no match ⇒ the first pair the account holds. */
	boards?: readonly string[]
}

const DemoHexCard: React.FC<DemoHexCardProps> = ({ onFlash, flashing, boards }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const [busy, setBusy] = useState(false)
	const held = DEMO_PAIRS.filter(
		(p) => accountHasGroup(adsumAccount, p.group) && demoPairServed(adsumAccount?.servedDemoTools, p.group),
	)
	const pair = held.find((p) => boards?.some((b) => p.board.test(b))) ?? held[0]
	// Which pair, and whether the board on the desk chose it or it was simply the first one held.
	const matched = !!pair && !!boards?.some((b) => pair.board.test(b))
	useEffect(() => {
		if (pair) {
			cardShown("demo_hex", { pair: pair.group, board_matched: String(matched) })
		}
	}, [pair, matched])
	if (!pair) {
		return null
	}
	const state = flashing ?? (busy ? "Starting…" : undefined)
	return (
		<div
			data-testid={pair.testId}
			style={{
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.55)}`,
				background: "var(--vscode-input-background)",
				borderRadius: "10px",
				padding: "12px 14px",
			}}>
			<div
				style={{
					display: "flex",
					alignItems: "baseline",
					gap: "8px",
					flexWrap: "wrap",
					marginBottom: "5px",
				}}>
				<span style={{ fontSize: "13px", fontWeight: 600, color: "var(--vscode-foreground)" }}>
					<i className="codicon codicon-rocket" style={{ fontSize: "12px", color: BRAND_CORAL, marginRight: "6px" }} />
					{pair.title}
				</span>
				<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>{pair.badge}</span>
			</div>
			<div style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" }}>{pair.body}</div>
			{/* The limits, above the action. Not a warning colour: they are terms, not a status. */}
			<div data-testid="demo-limits" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
				{pair.limits.map((limit) => (
					<span
						key={limit}
						style={{
							fontSize: "11px",
							padding: "2px 8px",
							borderRadius: "999px",
							color: "var(--vscode-foreground)",
							border: "1px solid color-mix(in srgb, var(--vscode-foreground) 22%, transparent)",
						}}>
						{limit}
					</span>
				))}
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
				{state ? (
					<span
						data-testid="demo-hex-flashing"
						style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
						Flashing {state}
					</span>
				) : (
					<>
						<button
							data-testid="demo-hex-flash"
							onClick={() => {
								cardAction("demo_hex", "flash", { pair: pair.group })
								setBusy(true)
								void Promise.resolve(onFlash(pair.prompt)).finally(() => setBusy(false))
							}}
							style={{
								padding: "5px 12px",
								borderRadius: "6px",
								fontSize: "12px",
								fontWeight: 600,
								cursor: "pointer",
								// Cyan, not coral: the frame carries the identity, the button carries the action,
								// and the surface has exactly one meaning per colour.
								border: `1px solid ${BRAND_CYAN_UI}`,
								background: BRAND_CYAN_UI,
								color: "#04222b",
							}}
							type="button">
							{pair.action}
						</button>
						<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>{pair.after}</span>
					</>
				)}
			</div>
			{pair.licence && (
				<div
					data-testid="demo-licence"
					style={{ fontSize: "11px", marginTop: "8px", color: "var(--vscode-descriptionForeground)" }}>
					{pair.licence}
				</div>
			)}
			{pair.protection && (
				<div
					data-testid="demo-protection"
					style={{
						fontSize: "11px",
						lineHeight: 1.5,
						marginTop: "10px",
						paddingTop: "9px",
						borderTop: "1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent)",
						color: "var(--vscode-descriptionForeground)",
					}}>
					<span style={{ color: "var(--vscode-foreground)" }}>What protects this image today. </span>
					{pair.protection}
				</div>
			)}
		</div>
	)
}

export { DEMO_PAIRS }
export default DemoHexCard
