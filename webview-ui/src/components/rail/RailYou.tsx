import type { AdsumAccountState } from "@shared/adsumAccount"
import { GROUP_WORDS } from "@shared/adsumGroupWords"
import type React from "react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SignInWaiting } from "../chat/welcome/GatePanel"
import Info from "../common/Info"
import { normalizeApiConfiguration } from "../settings/utils/providerUtils"
import { R } from "./railStyles"

const fmtTokens = (n: number): string =>
	n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`

/** The three account words, and only three. A licence is any production or source group held. */
export function accountWord(account: AdsumAccountState | undefined): "Free" | "Registered" | "Licensed" {
	if (!account) {
		return "Free"
	}
	const licensed = (account.groups ?? []).some((g) => /-prod-hex$|-src$|-production$/.test(g))
	return licensed ? "Licensed" : "Registered"
}

interface Props {
	onSignIn: () => void
	onAccount: () => void
	onProvider: () => void
}

/**
 * [0.5 sessions first] One line: who you are, the account word, the model, and tokens left when they are
 * measured (the free tier). Expanded: the sets the account opens, the licences, the provider, the links.
 */
const RailYou: React.FC<Props> = ({ onSignIn, onAccount, onProvider }) => {
	const { adsumAccount, adsumSignInPending, freeTierRemainingTokens, apiConfiguration, mode, quota } =
		useExtensionState() as ReturnType<typeof useExtensionState> & {
			adsumAccount?: AdsumAccountState
			adsumSignInPending?: boolean
		}
	const [open, setOpen] = useState(false)
	const cfg = normalizeApiConfiguration(apiConfiguration, mode)
	const provider = cfg.selectedProvider
	const model = cfg.selectedModelId || "model"
	const free = provider === "adsum-free"
	const tokens = free ? freeTierRemainingTokens : undefined
	// The host's one quota word wins when it is there; the raw count is the fallback for an older state.
	const low = quota ? quota.kind === "low" : tokens !== undefined && tokens > 0 && tokens < 100_000
	const zero = quota ? quota.kind === "spent" : tokens === 0
	const limitedUntil =
		free && quota?.kind === "limited"
			? quota.resetsAt
				? new Date(quota.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
				: ""
			: undefined
	const word = accountWord(adsumAccount)
	const who = adsumSignInPending ? "Signing in…" : adsumAccount ? adsumAccount.email.split("@")[0] : "Not signed in"
	const sets = (adsumAccount?.groups ?? []).map((g) => GROUP_WORDS[g]).filter(Boolean)

	return (
		<div data-testid="rail-you" style={R.block}>
			<button
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 7,
					fontSize: 12,
					color: "var(--vscode-foreground)",
					background: "none",
					border: 0,
					padding: 0,
					cursor: "pointer",
					width: "100%",
					textAlign: "left",
					whiteSpace: "nowrap",
					overflow: "hidden",
				}}
				type="button">
				<span
					aria-hidden="true"
					style={{
						width: 16,
						height: 16,
						borderRadius: "50%",
						background: adsumAccount ? R.coral : "color-mix(in srgb, var(--vscode-foreground) 20%, transparent)",
						color: adsumAccount ? "#fff" : "var(--vscode-descriptionForeground)",
						fontSize: 9,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						fontWeight: 700,
						flex: "none",
					}}>
					{adsumAccount ? adsumAccount.email[0]?.toUpperCase() : "·"}
				</span>
				<span style={{ fontWeight: 600, flex: "none" }}>{who}</span>
				<span style={{ color: "var(--vscode-descriptionForeground)", overflow: "hidden", textOverflow: "ellipsis" }}>
					· {adsumAccount ? `${word} · ` : free ? "Free tier · " : ""}
					{tokens !== undefined ? (
						<b
							style={{
								color: zero ? "var(--vscode-errorForeground)" : low ? R.warn : "var(--vscode-foreground)",
							}}>
							{fmtTokens(tokens)}
						</b>
					) : (
						"your key"
					)}
					{limitedUntil !== undefined ? <b style={{ color: R.warn }}> · paused</b> : null}
				</span>
			</button>
			{adsumSignInPending && <SignInWaiting compact />}
			{open && (
				<div
					style={{
						border: "1px solid var(--vscode-panel-border, color-mix(in srgb, var(--vscode-foreground) 18%, transparent))",
						borderRadius: 6,
						padding: "8px 10px",
						display: "grid",
						gridTemplateColumns: "auto 1fr",
						gap: "3px 10px",
						...R.meta,
					}}>
					<span>Account</span>
					<span>
						{adsumAccount ? (
							<>
								<b style={{ color: "var(--vscode-foreground)", fontWeight: 500 }}>{adsumAccount.email}</b> ·{" "}
								{word}
								{adsumAccount.emailVerified === false ? " · not verified yet" : ""}
							</>
						) : (
							<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
								Not signed in
								<Info text="A free account, no card, opens cellular, LoRa, satellite and the gateway demos. Sign in with your email; the code arrives in a minute." />
							</span>
						)}
					</span>
					{sets.length > 0 && (
						<>
							<span>Opens</span>
							<span>{sets.join(" · ")}</span>
						</>
					)}
					<span>Inference</span>
					<span>
						{free ? "Adsum free tier" : provider} ·{" "}
						<b style={{ color: "var(--vscode-foreground)", fontWeight: 500 }}>{model}</b>
						{tokens !== undefined ? ` · ${fmtTokens(tokens)} tokens left` : " · your key"}
						{low ? <b style={{ color: R.warn }}> · running low</b> : null}
						{zero ? <b style={{ color: "var(--vscode-errorForeground)" }}> · spent</b> : null}
						{limitedUntil !== undefined ? (
							<b style={{ color: R.warn }}>
								{limitedUntil ? ` · paused until ${limitedUntil}` : " · paused, retrying"}
							</b>
						) : null}
					</span>
					<span />
					<span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
						{adsumAccount ? (
							<button onClick={onAccount} style={R.link} type="button">
								Account
							</button>
						) : (
							<button onClick={onSignIn} style={R.link} type="button">
								Sign in
							</button>
						)}
						<button onClick={onProvider} style={R.link} type="button">
							Change provider
						</button>
						{(low || zero) && (
							<button onClick={onProvider} style={R.link} type="button">
								Add a key
							</button>
						)}
					</span>
				</div>
			)}
		</div>
	)
}

export default RailYou
