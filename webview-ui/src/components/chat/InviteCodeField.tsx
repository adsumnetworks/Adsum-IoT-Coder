import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { TicketIcon } from "lucide-react"
import { useState } from "react"
import { AdsumServiceClient } from "@/services/grpc-client"

type FieldState = "idle" | "open" | "submitting" | "success" | "error"

interface SuccessData {
	grantedTokens: number
	newQuota: number
}

/**
 * Collapsible "Have an invite code?" field. Reused in AdsumFreeProvider (settings)
 * and QuotaExhaustedCard. On success the host-side handler updates the in-memory
 * quota so the token chip refreshes immediately via onFreeTokensChanged.
 */
const InviteCodeField = () => {
	const [state, setState] = useState<FieldState>("idle")
	const [code, setCode] = useState("")
	const [errorMsg, setErrorMsg] = useState("")
	const [success, setSuccess] = useState<SuccessData | null>(null)

	const open = () => setState("open")

	const submit = async () => {
		const trimmed = code.trim().toUpperCase().replace(/[\s-]/g, "")
		if (!trimmed) {
			setErrorMsg("Enter a code first.")
			setState("error")
			return
		}
		setState("submitting")
		try {
			const res = await AdsumServiceClient.redeemInviteCode(StringRequest.create({ value: trimmed }))
			const data: { grantedTokens: number; newQuota: number } = JSON.parse(res.value ?? "{}")
			setSuccess({ grantedTokens: data.grantedTokens ?? 0, newQuota: data.newQuota ?? 0 })
			setState("success")
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : "Redemption failed — try again later.")
			setState("error")
		}
	}

	if (state === "idle") {
		return (
			<button
				className="mt-2 text-sm bg-transparent border-none p-0 cursor-pointer inline-flex items-center gap-1"
				onClick={open}
				style={{ color: "var(--vscode-descriptionForeground)", textDecoration: "underline" }}>
				<TicketIcon size={14} /> Have an invite code?
			</button>
		)
	}

	if (state === "success" && success) {
		return (
			<p className="mt-2 text-sm m-0" style={{ color: "var(--vscode-charts-green, #4ec9b0)" }}>
				✓ +{success.grantedTokens.toLocaleString()} free tokens added — new balance {success.newQuota.toLocaleString()}.
			</p>
		)
	}

	return (
		<div className="mt-2">
			<p className="m-0 mb-1 text-sm font-semibold" style={{ color: "var(--vscode-foreground)" }}>
				Have an invite code?
			</p>
			<p className="m-0 mb-2 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
				Redeem it for extra free-tier credit.
			</p>
			<div className="flex gap-2">
				<input
					autoFocus
					className="flex-1 text-sm px-2 py-1 rounded"
					disabled={state === "submitting"}
					onChange={(e) => {
						setCode(e.target.value)
						if (state === "error") {
							setState("open")
						}
					}}
					onKeyDown={(e) => e.key === "Enter" && submit()}
					placeholder="ADSUM-XXXX-XXXX"
					style={{
						background: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						border: "1px solid var(--vscode-input-border, #3c3c3c)",
						outline: "none",
					}}
					type="text"
					value={code}
				/>
				<VSCodeButton disabled={state === "submitting"} onClick={submit} style={{ flexShrink: 0 }}>
					{state === "submitting" ? "Applying…" : "Apply"}
				</VSCodeButton>
			</div>
			{state === "error" && errorMsg && (
				<p className="mt-1 text-xs m-0" style={{ color: "var(--vscode-errorForeground)" }}>
					{errorMsg}
				</p>
			)}
		</div>
	)
}

export default InviteCodeField
