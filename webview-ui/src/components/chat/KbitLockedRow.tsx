import { GROUP_WORDS } from "@shared/adsumGroupWords"
import { useState } from "react"
import { ASK_FOR_DETAILS, isRequestOnlyGroup } from "@/components/chat/welcome/welcomeIntents"
import { BRAND_CYAN_UI } from "./brandColors"
import { PersonLink } from "./KbitCredit"

/**
 * The locked-bit row in a transcript.
 *
 * Two rules meet here. The first: CREDIT IS NEVER WITHHELD. A bit the developer cannot read was
 * still curated by someone, and their name is on the row exactly as it is on a loaded one — gating
 * access is a commercial decision, and taking the byline off would be a different, worse one.
 *
 * The second: THE DOOR NAMED IS THE DOOR THAT OPENS. Some sets are opened by a person, one developer
 * at a time; registering never reaches them. Offering "Register" against one of those sends someone
 * through a sign-up that ends exactly where it started, so a by-request set says so and offers the
 * one action the rest of the product uses — the same phrase, so it is learned once.
 *
 * The third: the task does not stop. The row says what is missing and the assistant carries on with
 * what it does have. A run that halts because one bit was locked would punish the developer for our
 * pricing, and the honest thing is to keep working and say what would have been better.
 */

export interface KbitLockedPayload {
	id: string
	title: string
	author?: string
	group?: string
	links?: Record<string, string>
	/** True when the bit was in reach and no longer is — a revoked grant reads differently from one
	 *  never held, and telling someone to "register" when they already have an account is nonsense. */
	revoked?: boolean
	/** One line on what the set does for the reader. Nothing is teased and nothing is listed. */
	summary?: string
}

export function parseKbitLockedPayload(text: string | undefined): KbitLockedPayload | null {
	if (!text) {
		return null
	}
	try {
		const p = JSON.parse(text) as KbitLockedPayload
		return p?.id ? p : null
	} catch {
		return null
	}
}

interface KbitLockedRowProps {
	bit: KbitLockedPayload
	/** Opens the register gate. Absent ⇒ the row still renders, just without the button. */
	onRegister?: () => void
	/** Opens the request form — for a by-request set, for a signed-in developer, and for the revoked case. */
	onRequestAccess?: () => void
	/**
	 * True when an account is signed in. The row then never says "register": the account exists, so
	 * the words are "not in your account" and the one action is the ask. [15 Sep 2026] Without this the
	 * row had two states, revoked or not, and a registered developer meeting a group they were never
	 * granted read "needs a registered account" beside a Register button that could open nothing — the
	 * home screen's cards had read the account for the same decision since 13 Sep, and the transcript
	 * had not, so the two surfaces disagreed about the same thing.
	 */
	signedIn?: boolean
}

/** What a locked row says after the title, by state. Exported so the states can be tested as words. */
export function lockedWords(state: { byRequest: boolean; revoked: boolean; signedIn: boolean }): string {
	if (state.byRequest) {
		return "available on request"
	}
	if (state.revoked) {
		return "no longer in your account"
	}
	if (state.signedIn) {
		return "not in your account"
	}
	return "needs a registered account"
}

export const KbitLockedRow = ({ bit, onRegister, onRequestAccess, signedIn = false }: KbitLockedRowProps) => {
	const [hover, setHover] = useState(false)
	const revoked = !!bit.revoked
	const byRequest = isRequestOnlyGroup(bit.group)
	// Register is offered only when registering is what opens the bit: no account yet, and a set the
	// registered tier carries. Every other state has the one door, under its one name.
	const registerOpens = !byRequest && !revoked && !signedIn
	// The set is named in the developer's words, so they can ask for the right thing instead of guessing.
	const setWords = bit.group ? GROUP_WORDS[bit.group] : undefined
	// One action, one phrase. "Ask for more details" is what the card pill and the sub-line on the
	// home screen say for the same thing, so the developer meets one door and not three names for it.
	const askButton = onRequestAccess && (
		<button
			data-testid="kbit-locked-request"
			onClick={onRequestAccess}
			style={{
				padding: "2px 8px",
				fontSize: "11px",
				borderRadius: "5px",
				cursor: "pointer",
				border: "1px solid color-mix(in srgb, var(--vscode-foreground) 22%, transparent)",
				background: "none",
				color: "var(--vscode-foreground)",
			}}
			type="button">
			{ASK_FOR_DETAILS}
		</button>
	)
	return (
		<div
			className="text-[11px] mt-1.5 flex items-center gap-2 flex-wrap"
			data-testid="kbit-locked-row"
			style={{ color: "var(--vscode-descriptionForeground)" }}>
			<span
				aria-hidden="true"
				className="codicon codicon-lock shrink-0"
				style={{ fontSize: "13px", opacity: 0.75, width: "17px", textAlign: "center" }}
			/>
			<span className="uppercase tracking-wide font-semibold text-[10px] opacity-70">knowledge bit</span>
			{/* 78%, not dimmed to nothing: reading what is missing is what makes asking worth doing. */}
			<span
				className="truncate max-w-[240px]"
				style={{ color: "color-mix(in srgb, var(--vscode-foreground) 78%, transparent)" }}>
				{bit.title}
			</span>
			{bit.author && (
				<span>
					curated by <PersonLink links={bit.links} name={bit.author} />
				</span>
			)}
			<span data-testid="kbit-locked-words">
				· {lockedWords({ byRequest, revoked, signedIn })}
				{setWords ? ` · ${setWords}` : ""}
			</span>
			{bit.summary && byRequest && <span className="basis-full pl-[25px] opacity-90">{bit.summary}</span>}
			{!registerOpens ? (
				askButton
			) : onRegister ? (
				<button
					data-testid="kbit-locked-register"
					onClick={onRegister}
					onMouseEnter={() => setHover(true)}
					onMouseLeave={() => setHover(false)}
					style={{
						padding: "2px 9px",
						fontSize: "11px",
						fontWeight: 600,
						borderRadius: "5px",
						cursor: "pointer",
						border: `1px solid ${BRAND_CYAN_UI}`,
						background: BRAND_CYAN_UI,
						color: "#04222b",
						opacity: hover ? 0.9 : 1,
					}}
					type="button">
					Register
				</button>
			) : null}
		</div>
	)
}
