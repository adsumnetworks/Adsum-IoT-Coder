import type { AdsumAccountState } from "@shared/adsumAccount"
import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BRAND_CORAL } from "../brandColors"

/**
 * Who is signed in, shown beside the Environment label.
 *
 * Coral, because coral is identity in this product — it is the logo's colour and this is the one
 * element on the surface that says who you are. Never cyan: cyan is action, and an account chip is
 * not something to click through. It is a fact about the window.
 *
 * Absent when nobody is signed in. There is deliberately no "Sign in" affordance here: the gate is
 * where registering is asked for, with the reason attached, and a second door with no reason beside
 * it would teach people to ignore both.
 */
const AccountChip: React.FC = () => {
	const { adsumAccount } = useExtensionState() as { adsumAccount?: AdsumAccountState }
	if (!adsumAccount?.email) {
		return null
	}
	const initial = (adsumAccount.name || adsumAccount.email).trim().charAt(0).toUpperCase()
	return (
		<span
			data-testid="account-chip"
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: "5px",
				fontSize: "10px",
				letterSpacing: "normal",
				textTransform: "none",
				color: "var(--vscode-descriptionForeground)",
				border: `1px solid color-mix(in srgb, ${BRAND_CORAL} 45%, transparent)`,
				borderRadius: "999px",
				padding: "1px 7px 1px 2px",
				maxWidth: "100%",
				minWidth: 0,
			}}
			title={`Signed in as ${adsumAccount.email}`}>
			<span
				aria-hidden="true"
				style={{
					width: "14px",
					height: "14px",
					borderRadius: "50%",
					background: BRAND_CORAL,
					color: "#fff",
					fontSize: "9px",
					fontWeight: 700,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					flexShrink: 0,
				}}>
				{initial}
			</span>
			<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{adsumAccount.email}</span>
			<span style={{ opacity: 0.8, flexShrink: 0 }}>· Registered</span>
		</span>
	)
}

export default AccountChip
