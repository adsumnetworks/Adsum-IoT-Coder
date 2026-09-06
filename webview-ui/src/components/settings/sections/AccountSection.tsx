import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useState } from "react"
import { BRAND_CYAN_TEXT, BRAND_CYAN_UI } from "@/components/chat/brandColors"
import GatePanel from "@/components/chat/welcome/GatePanel"
import RequestAccessForm, { FAMILIES } from "@/components/chat/welcome/RequestAccessForm"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AdsumServiceClient } from "@/services/grpc-client"
import Section from "../Section"

/**
 * Settings → Account. What is unlocked, in words, and the two doors out.
 *
 * Groups are shown as WORDS, never as ids: "Advanced cellular" is a thing the developer recognises,
 * `cellular-advanced` is a thing our database recognises. The one place ids would help is a support
 * conversation, and that is not worth making everyone else read them.
 *
 * Signing out is confirmed, because it is not obviously reversible from where the developer stands:
 * the confirm says exactly what locks and — just as important — what does not.
 */

const NEUTRAL_EDGE = "color-mix(in srgb, var(--vscode-foreground) 22%, transparent)"

/** Group id → the words for it. An id with no entry here still shows, so a new group is never silent. */
const GROUP_WORDS: Record<string, string> = {
	"cellular-advanced": "Advanced cellular",
	"edge-ai-advanced": "On-device inference",
	"lew840x-demo-hex": "LEW840x demo hexes",
	"lew840x-prod-hex": "LEW840x production hexes",
	"lew840x-ble-src": "LEW840x BLE source",
	"lew840x-esp-src": "LEW840x ESP source",
	"lew840x-9160-src": "LEW840x nRF9160 source",
	"blg20-demo-hex": "BLG20 demo hexes",
	"blg20-prod-hex": "BLG20 production hexes",
	"blg20-ble-src": "BLG20 BLE source",
	"blg20-esp-src": "BLG20 ESP source",
	"blg20-9151-src": "BLG20 nRF9151 source",
	all: "Everything",
}

const SOURCE_GROUPS = Object.keys(GROUP_WORDS).filter((g) => g.endsWith("-src"))

interface AccountSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const AccountSection: React.FC<AccountSectionProps> = ({ renderSectionHeader }) => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	const [gate, setGate] = useState(false)
	const [requesting, setRequesting] = useState(false)
	const [confirmSignOut, setConfirmSignOut] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [deleteError, setDeleteError] = useState<string | null>(null)

	const granted = SOURCE_GROUPS.filter((g) => adsumAccount?.groups.includes(g))
	const open = adsumAccount?.openRequests ?? []

	return (
		<div>
			{renderSectionHeader("account")}
			<Section>
				{!adsumAccount ? (
					<div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
						<p data-testid="account-signed-out" style={{ fontSize: "12px", margin: 0, lineHeight: 1.5 }}>
							Not signed in. A free account unlocks LTE-M, NB-IoT, NTN, DECT NR+ and on-device inference — and the
							Fanstel gateway demo hexes.
						</p>
						<button data-testid="account-signin" onClick={() => setGate(true)} style={primaryStyle} type="button">
							Sign in
						</button>
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
						<div
							data-testid="account-kv"
							style={{
								display: "grid",
								gridTemplateColumns: "auto 1fr",
								gap: "6px 14px",
								fontSize: "12px",
								alignItems: "baseline",
							}}>
							<Key>Signed in as</Key>
							<Val>
								<b style={{ color: "var(--vscode-foreground)" }}>{adsumAccount.email}</b>
								{!adsumAccount.emailVerified && " · not verified yet"}
							</Val>

							<Key>Unlocked</Key>
							<Val>
								{adsumAccount.groups.length === 0
									? "Nothing yet — a grant can take a business day."
									: adsumAccount.groups.map((g) => GROUP_WORDS[g] ?? g).join(" · ")}
							</Val>

							<Key>Template source</Key>
							<Val>
								{granted.length > 0 ? (
									granted.map((g) => GROUP_WORDS[g] ?? g).join(" · ")
								) : open.length > 0 ? (
									`${open.map(familyLabel).join(", ")} — request sent, pending`
								) : (
									<>
										none ·{" "}
										<button
											data-testid="account-request"
											onClick={() => setRequesting(true)}
											style={linkStyle}
											type="button">
											Request access
										</button>
									</>
								)}
							</Val>

							<Key>Demo</Key>
							<Val>
								{accountHasGroup(adsumAccount, "lew840x-demo-hex")
									? "LEW840x hexes available · cellular in 60-minute sessions"
									: "Not unlocked on this account"}
							</Val>
						</div>

						<div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
							<button
								data-testid="account-signout"
								onClick={() => setConfirmSignOut(true)}
								style={secondaryStyle}
								type="button">
								Sign out
							</button>
							{/* A link, not a button, and in the error colour — it is the one control here that
							    cannot be undone, and it should look like the last resort it is. */}
							<button
								data-testid="account-delete"
								onClick={() => {
									setDeleteError(null)
									setConfirmDelete(true)
								}}
								style={{ ...linkStyle, color: "var(--vscode-errorForeground)" }}
								type="button">
								Delete account…
							</button>
						</div>
						<p style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", margin: 0 }}>
							Signing out keeps your projects and logs. Cellular knowledge locks again on this machine.
						</p>
					</div>
				)}
			</Section>

			{confirmSignOut && (
				// biome-ignore lint/a11y/useKeyWithClickEvents: the scrim dismisses; the buttons carry the decision.
				<div data-testid="signout-scrim" onClick={() => setConfirmSignOut(false)} style={scrimStyle}>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: stops the scrim, no behaviour of its own. */}
					<div
						aria-modal="true"
						data-testid="signout-confirm"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						style={dialogStyle}>
						<div
							style={{ fontSize: "14px", fontWeight: 600, color: "var(--vscode-foreground)", marginBottom: "5px" }}>
							Sign out of Adsum?
						</div>
						<div style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" }}>
							Cellular knowledge and the demo hexes lock again on this machine. Nothing of yours is deleted.
						</div>
						<div style={{ display: "flex", gap: "8px", marginTop: "13px" }}>
							<button
								data-testid="signout-confirm-yes"
								onClick={() => {
									setConfirmSignOut(false)
									AdsumServiceClient.signOutAccount(EmptyRequest.create({})).catch(console.error)
								}}
								style={primaryStyle}
								type="button">
								Sign out
							</button>
							<button onClick={() => setConfirmSignOut(false)} style={ghostStyle} type="button">
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{confirmDelete && (
				// biome-ignore lint/a11y/useKeyWithClickEvents: the scrim dismisses; the buttons carry the decision.
				<div data-testid="delete-scrim" onClick={() => setConfirmDelete(false)} style={scrimStyle}>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: stops the scrim, no behaviour of its own. */}
					<div
						aria-modal="true"
						data-testid="delete-confirm"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						style={dialogStyle}>
						<div
							style={{ fontSize: "14px", fontWeight: 600, color: "var(--vscode-foreground)", marginBottom: "5px" }}>
							Delete your Adsum account?
						</div>
						<div style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" }}>
							Your email, your sign-in and everything granted to you are erased. This cannot be undone. Your
							projects, your logs and your free-tier allowance on this machine are not touched.
						</div>
						{deleteError && (
							<div
								data-testid="delete-error"
								style={{ fontSize: "11px", color: "var(--vscode-errorForeground)", marginTop: "8px" }}>
								{deleteError}
							</div>
						)}
						<div style={{ display: "flex", gap: "8px", marginTop: "13px" }}>
							<button
								data-testid="delete-confirm-yes"
								onClick={async () => {
									const res = await AdsumServiceClient.deleteAccount(EmptyRequest.create({})).catch(() => ({
										value: "That didn’t go through. Nothing was deleted.",
									}))
									if (res.value) {
										setDeleteError(res.value)
									} else {
										setConfirmDelete(false)
									}
								}}
								style={{
									...secondaryStyle,
									borderColor: "var(--vscode-errorForeground)",
									color: "var(--vscode-errorForeground)",
								}}
								type="button">
								Delete my account
							</button>
							<button onClick={() => setConfirmDelete(false)} style={ghostStyle} type="button">
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			<GatePanel onClose={() => setGate(false)} open={gate} satisfied={!!adsumAccount} surface="settings" />
			<RequestAccessForm onClose={() => setRequesting(false)} open={requesting} />
		</div>
	)
}

const familyLabel = (id: string) => FAMILIES.find((f) => f.id === id)?.label.replace("Fanstel ", "") ?? id

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ color: "var(--vscode-descriptionForeground)", whiteSpace: "nowrap" }}>{children}</div>
)
const Val: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ color: "var(--vscode-descriptionForeground)", minWidth: 0 }}>{children}</div>
)

const primaryStyle: React.CSSProperties = {
	padding: "5px 12px",
	borderRadius: "6px",
	fontSize: "12px",
	fontWeight: 600,
	cursor: "pointer",
	border: `1px solid ${BRAND_CYAN_UI}`,
	background: BRAND_CYAN_UI,
	color: "#04222b",
}
const secondaryStyle: React.CSSProperties = {
	padding: "5px 12px",
	borderRadius: "6px",
	fontSize: "12px",
	cursor: "pointer",
	border: `1px solid ${NEUTRAL_EDGE}`,
	background: "var(--vscode-input-background)",
	color: "var(--vscode-foreground)",
}
const ghostStyle: React.CSSProperties = {
	padding: "5px 10px",
	borderRadius: "6px",
	fontSize: "12px",
	cursor: "pointer",
	border: "none",
	background: "none",
	color: "var(--vscode-descriptionForeground)",
}
const linkStyle: React.CSSProperties = {
	background: "none",
	border: "none",
	padding: 0,
	cursor: "pointer",
	font: "inherit",
	color: BRAND_CYAN_TEXT,
	textDecoration: "underline",
}
const scrimStyle: React.CSSProperties = {
	position: "fixed",
	inset: 0,
	background: "color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "16px",
	zIndex: 60,
}
const dialogStyle: React.CSSProperties = {
	width: "100%",
	maxWidth: "360px",
	background: "var(--vscode-editor-background)",
	border: `1px solid ${NEUTRAL_EDGE}`,
	borderRadius: "12px",
	padding: "18px",
	boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
}

export default AccountSection
