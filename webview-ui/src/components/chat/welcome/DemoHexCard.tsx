import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL, BRAND_CYAN_UI, brandAlpha } from "../brandColors"
import { DEMO_HEX_PROMPT, DEMO_PAIR_PROMPT_BLG20 } from "./welcomeIntents"

/**
 * The demo a registered developer can actually run, for whichever board's demo they hold.
 *
 * Coral frame, because this is the identity moment: our hardware partner's board, our signed builds.
 * It is the only card on this surface that puts bytes on a device, so it is the only one that earns
 * a coloured edge here.
 *
 * One card, a table of boards. It was one board hard-coded — the group, the title, the images and
 * the cap were all the LEW840x's — so an owner of the other board saw NOTHING: no card, no limits,
 * no statement of what protects the image, and no way to the demo except guessing a sentence into
 * the chat box. The limits are stated ABOVE the action, before anything is downloaded: a demo whose
 * limits are discovered afterwards is a demo that gets returned.
 */

/** One board's demo, in the words the developer reads. Adding a board is a row here, not a component. */
interface DemoPair {
	/** The group that says this developer holds it. */
	group: string
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
		title: "Flash the LEW840x demo",
		badge: "Included · registered",
		body: "Three signed hexes: BLE scanner, ESP32 uplink, nRF9160 bearer. Needs nrfutil and esptool on this machine.",
		limits: ["Wi-Fi and Ethernet unlimited", "Cellular in 60-minute sessions, for evaluation"],
		action: "Flash demo ▸",
		after: "≈ 3 min · you will be asked for the ports",
		prompt: DEMO_HEX_PROMPT,
		testId: "demo-hex-card",
	},
	{
		group: "blg20-demo-hex",
		title: "BLG20x demo pair",
		badge: "Included · registered",
		body: "Two images, one for each half of the board, built from a tagged source and signed.",
		limits: ["Limited use for demos", "Terrestrial and satellite"],
		action: "Install into this project",
		after: "Then program each half with your own probe. Take the serial number from the tool, never one you remember.",
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
}

const DemoHexCard: React.FC<DemoHexCardProps> = ({ onFlash, flashing }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const [busy, setBusy] = useState(false)
	const pair = DEMO_PAIRS.find((p) => accountHasGroup(adsumAccount, p.group))
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
