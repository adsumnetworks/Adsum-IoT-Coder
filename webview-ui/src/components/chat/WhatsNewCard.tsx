import type React from "react"
import { useEffect, useState } from "react"
import { BRAND_CORAL } from "./brandColors"

const DISMISSED_KEY = "adsum.whatsNew.0.5"

/**
 * Whether the card would show, asked from outside — same shape as DockCoachMark's and FirstSteps'
 * eligibility exports. localStorage can throw in a locked-down webview; a failure to read means
 * "do not show", never a crash.
 */
export function whatsNewEligible(): boolean {
	try {
		return localStorage.getItem(DISMISSED_KEY) !== "1"
	} catch {
		return false
	}
}

/**
 * [0.5 sessions first] One-time announcement for the 0.5 redesign, under First steps in an empty session
 * tab. Says what moved and where to find it, nothing more — the cards it names (the rail, the palette)
 * speak for themselves once a developer opens them. Dismiss is for good, same contract as First steps and
 * DockCoachMark: the localStorage key never comes back once the × is clicked.
 */
interface WhatsNewCardProps {
	/**
	 * The rail's notice slot: the card draws the coral frame itself, so the frame goes when the card does.
	 * A wrapper around a card that renders nothing once dismissed left an empty coral strip behind.
	 */
	framed?: boolean
}

const WhatsNewCard: React.FC<WhatsNewCardProps> = ({ framed = false }) => {
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		setVisible(whatsNewEligible())
	}, [])

	if (!visible) {
		return null
	}

	const dismiss = () => {
		try {
			localStorage.setItem(DISMISSED_KEY, "1")
		} catch {
			/* a webview with storage blocked still gets to dismiss it for this session */
		}
		setVisible(false)
	}

	const card = (
		<div data-testid="whats-new-card" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 2px" }}>
			<div className="flex items-center justify-between gap-2">
				<span style={{ fontSize: 11.5, fontWeight: 600, color: BRAND_CORAL }}>0.5 · Sessions first</span>
				<button
					aria-label="Dismiss What's new"
					onClick={dismiss}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						fontSize: 12,
						lineHeight: 1,
						color: "var(--vscode-descriptionForeground)",
						opacity: 0.6,
						padding: "2px 4px",
					}}
					type="button">
					×
				</button>
			</div>
			<p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" }}>
				The sidebar is now the rail; a session is a tab beside your code; the cards live in What can you ask (⌘K).
			</p>
		</div>
	)

	if (!framed) {
		return card
	}
	return (
		<div
			aria-live="polite"
			data-testid="whats-new-frame"
			role="status"
			style={{
				border: `1px solid color-mix(in srgb, ${BRAND_CORAL} 45%, transparent)`,
				background: `color-mix(in srgb, ${BRAND_CORAL} 5%, transparent)`,
				borderRadius: 6,
				padding: "2px 8px",
			}}>
			{card}
		</div>
	)
}

export default WhatsNewCard
