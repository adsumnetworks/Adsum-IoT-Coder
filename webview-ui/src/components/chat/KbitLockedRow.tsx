import { useState } from "react"
import { BRAND_CYAN_UI } from "./brandColors"
import { PersonLink } from "./KbitCredit"

/**
 * The locked-bit row in a transcript.
 *
 * Two rules meet here. The first: CREDIT IS NEVER WITHHELD. A bit the developer cannot read was
 * still curated by someone, and their name is on the row exactly as it is on a loaded one — gating
 * access is a commercial decision, and taking the byline off would be a different, worse one.
 *
 * The second: the task does not stop. The row says what is missing and the assistant carries on with
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
	/** Opens the template-source request form, for the revoked / never-granted case. */
	onRequestAccess?: () => void
}

export const KbitLockedRow = ({ bit, onRegister, onRequestAccess }: KbitLockedRowProps) => {
	const [hover, setHover] = useState(false)
	const revoked = !!bit.revoked
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
			{/* 78%, not dimmed to nothing: reading what is missing is what makes registering worth doing. */}
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
			<span>· {revoked ? "no longer in your account" : "needs a registered account"}</span>
			{revoked ? (
				onRequestAccess && (
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
						Request access
					</button>
				)
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
