import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import React, { useEffect, useRef, useState } from "react"
import { AdsumServiceClient } from "@/services/grpc-client"
import { BRAND_CYAN_TEXT, BRAND_CYAN_UI } from "../brandColors"

/**
 * "Register to unlock cellular" — the one message a developer sees at the gate.
 *
 * Never the word "Pro". Phase 1 asks for an account, not for money, and naming a paid tier at a
 * gate that costs nothing is the fastest way to teach someone to stop reading our gates.
 *
 * Three states, because there are exactly three honest things that can be true here: we can ask, we
 * cannot reach the network, or we are waiting on a verification email. Each says what is happening
 * and what the developer can do — never a spinner that never ends.
 */

export type GateVariant = "default" | "offline" | "verify"

interface GatePanelProps {
	open: boolean
	variant?: GateVariant
	/** Shown in the verify state so the developer can see WHICH address to go and open. */
	email?: string
	onClose: () => void
	/** Told which surface opened the gate, for the funnel. */
	surface?: string
}

/**
 * A neutral edge that is visible in BOTH themes.
 *
 * `--vscode-widget-border` is transparent in several light themes, which left the two secondary
 * provider buttons as bare text on white — the exact failure the light-theme screenshot is for.
 * Deriving the edge from the foreground colour cannot have that failure in either theme.
 */
const NEUTRAL_EDGE = "color-mix(in srgb, var(--vscode-foreground) 22%, transparent)"

const PROVIDERS: { id: "github" | "google" | "email"; label: string; icon: string; primary?: boolean }[] = [
	{ id: "github", label: "Continue with GitHub", icon: "github", primary: true },
	{ id: "google", label: "Continue with Google", icon: "globe" },
	{ id: "email", label: "Continue with email", icon: "mail" },
]

const GatePanel: React.FC<GatePanelProps> = ({ open, variant = "default", email, onClose, surface }) => {
	const dialogRef = useRef<HTMLDivElement>(null)
	const [busy, setBusy] = useState<string | null>(null)
	// If the browser could not be opened, the URL is the fallback — a link the developer can copy is
	// a better answer than a toast that says it failed.
	const [manualUrl, setManualUrl] = useState<string | null>(null)

	// Esc closes, and focus lands inside the dialog so the keyboard is not stranded behind the scrim.
	useEffect(() => {
		if (!open) {
			return
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation()
				onClose()
			}
		}
		window.addEventListener("keydown", onKey, true)
		// Focus the ACTION, not the ×. Landing on the close button puts a focus ring on "get me out of
		// here" and makes Enter dismiss the thing the developer just opened.
		const first = dialogRef.current?.querySelector<HTMLElement>(
			'[data-testid^="gate-provider"], [data-testid="gate-retry"], [data-testid="gate-resend"]',
		)
		;(first ?? dialogRef.current?.querySelector<HTMLElement>("button"))?.focus()
		return () => window.removeEventListener("keydown", onKey, true)
	}, [open, onClose])

	if (!open) {
		return null
	}

	const signIn = async (provider: "github" | "google" | "email") => {
		setBusy(provider)
		try {
			const res = await AdsumServiceClient.startSignIn(StringRequest.create({ value: provider }))
			// A non-empty value is the URL we could not open for them.
			setManualUrl(res.value || null)
		} catch {
			setManualUrl(null)
		} finally {
			setBusy(null)
		}
	}

	const retry = async () => {
		try {
			await AdsumServiceClient.refreshAccount(EmptyRequest.create({}))
		} catch {
			/* still offline; the panel keeps saying so rather than pretending */
		}
	}

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the scrim is a dismissal affordance; Esc is handled above.
		<div
			data-testid="gate-scrim"
			onClick={onClose}
			style={{
				position: "absolute",
				inset: 0,
				background: "color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)",
				backdropFilter: "blur(2px)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "16px",
				zIndex: 40,
			}}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: stops the scrim's dismissal, no behaviour of its own. */}
			<div
				aria-modal="true"
				data-surface={surface}
				data-testid="gate-panel"
				onClick={(e) => e.stopPropagation()}
				ref={dialogRef}
				role="dialog"
				style={{
					width: "100%",
					maxWidth: "380px",
					background: "var(--vscode-editor-background)",
					border: `1px solid ${NEUTRAL_EDGE}`,
					borderRadius: "12px",
					padding: "18px 18px 16px",
					position: "relative",
					boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
				}}>
				<button
					aria-label="Close"
					data-testid="gate-close"
					onClick={onClose}
					style={{
						position: "absolute",
						top: "10px",
						right: "10px",
						background: "none",
						border: "none",
						cursor: "pointer",
						color: "var(--vscode-descriptionForeground)",
						fontSize: "15px",
						lineHeight: 1,
						padding: "2px 6px",
					}}
					type="button">
					×
				</button>

				{variant === "offline" ? (
					<>
						<Title>Registering needs internet</Title>
						<Lead>
							Adsum can’t be reached right now. Your BLE, Wi-Fi and Ethernet work is unaffected — the cellular cards
							stay locked until you’re back online.
						</Lead>
						<Row>
							<Secondary onClick={retry} testId="gate-retry">
								Try again
							</Secondary>
							<Ghost onClick={onClose}>Not now</Ghost>
						</Row>
					</>
				) : variant === "verify" ? (
					<>
						<Title>Check your inbox</Title>
						<Lead>
							We sent a verification link to <b style={{ color: "var(--vscode-foreground)" }}>{email}</b>. Open it
							to finish — this panel updates by itself.
						</Lead>
						<Row>
							<Secondary onClick={() => signIn("email")} testId="gate-resend">
								Resend link
							</Secondary>
							<Ghost onClick={onClose}>Later</Ghost>
						</Row>
						<Fine>
							Wrong address?{" "}
							<button
								onClick={() => signIn("email")}
								style={{
									background: "none",
									border: "none",
									padding: 0,
									cursor: "pointer",
									color: BRAND_CYAN_TEXT,
									textDecoration: "underline",
									font: "inherit",
								}}
								type="button">
								Start again
							</button>
						</Fine>
					</>
				) : (
					<>
						<Title>Register to unlock cellular</Title>
						<Lead>A free account. It unlocks:</Lead>
						<ul
							style={{
								margin: "8px 0 12px",
								paddingLeft: "18px",
								fontSize: "12px",
								lineHeight: 1.6,
								color: "var(--vscode-descriptionForeground)",
							}}>
							<li>LTE-M, NB-IoT, NTN and DECT NR+ knowledge and tools</li>
							<li>On-device inference on nRF54</li>
							<li>The Fanstel gateway demo hexes</li>
							<li>Template source, by request</li>
						</ul>
						<div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
							{PROVIDERS.map((p) => (
								<button
									data-testid={`gate-provider-${p.id}`}
									disabled={busy !== null}
									key={p.id}
									onClick={() => signIn(p.id)}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										gap: "8px",
										width: "100%",
										padding: "8px 12px",
										borderRadius: "7px",
										cursor: busy ? "default" : "pointer",
										fontSize: "12px",
										fontWeight: 600,
										border: p.primary ? `1px solid ${BRAND_CYAN_UI}` : `1px solid ${NEUTRAL_EDGE}`,
										background: p.primary ? BRAND_CYAN_UI : "var(--vscode-input-background)",
										color: p.primary ? "#04222b" : "var(--vscode-foreground)",
										opacity: busy && busy !== p.id ? 0.6 : 1,
									}}
									type="button">
									<i className={`codicon codicon-${p.icon}`} style={{ fontSize: "13px" }} />
									{busy === p.id ? "Opening your browser…" : p.label}
								</button>
							))}
						</div>
						{manualUrl && (
							<Fine>
								We couldn’t open your browser. Paste this in yourself:{" "}
								<code style={{ wordBreak: "break-all", color: "var(--vscode-foreground)" }}>{manualUrl}</code>
							</Fine>
						)}
						<Fine>
							Free. No card. You sign in in your browser and come straight back here. Your projects and logs stay on
							your machine.
						</Fine>
					</>
				)}
			</div>
		</div>
	)
}

const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ fontSize: "14px", fontWeight: 600, color: "var(--vscode-foreground)", marginBottom: "5px" }}>{children}</div>
)
const Lead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)" }}>{children}</div>
)
const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>{children}</div>
)
const Fine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ fontSize: "10.5px", lineHeight: 1.5, color: "var(--vscode-descriptionForeground)", marginTop: "10px" }}>
		{children}
	</div>
)
const Secondary: React.FC<{ children: React.ReactNode; onClick: () => void; testId?: string }> = ({
	children,
	onClick,
	testId,
}) => (
	<button
		data-testid={testId}
		onClick={onClick}
		style={{
			padding: "6px 12px",
			borderRadius: "6px",
			fontSize: "12px",
			cursor: "pointer",
			border: `1px solid ${NEUTRAL_EDGE}`,
			background: "var(--vscode-input-background)",
			color: "var(--vscode-foreground)",
		}}
		type="button">
		{children}
	</button>
)
const Ghost: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => (
	<button
		onClick={onClick}
		style={{
			padding: "6px 10px",
			borderRadius: "6px",
			fontSize: "12px",
			cursor: "pointer",
			border: "none",
			background: "none",
			color: "var(--vscode-descriptionForeground)",
		}}
		type="button">
		{children}
	</button>
)

export default GatePanel
