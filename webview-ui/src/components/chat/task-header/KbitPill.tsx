import type { ClineMessage } from "@shared/ExtensionMessage"
import { BRAND_CORAL } from "@/components/chat/brandColors"
import { type KbitLoadedPayload, parseKbitPayload } from "@/components/chat/KbitCredit"
import { KbitMark, TbitMark } from "@/components/chat/KbitMark"

/**
 * Session attribution roster — who this session is standing on.
 *
 * Lives INSIDE the existing task-header box beside the cost badge (operator ruling): it is session-rollup
 * metadata of exactly the same class as cost, so it costs ZERO new rows when collapsed. That matters more
 * than anything else here — the conversation is the scarce resource, especially zoomed.
 *
 * Absent entirely until the first bit loads: the absence is itself an honest signal that a turn was
 * un-guided. Repeat loads of the same bit never reach the transcript at all (the host credits first use
 * only), so this pill is what tells you a bit is still in play.
 */

/** Distinct bits credited this session, in first-use order. */
export function collectSessionKbits(messages: ClineMessage[]): KbitLoadedPayload[] {
	const seen = new Map<string, KbitLoadedPayload>()
	for (const m of messages) {
		if (m.type === "say" && m.say === "kbit_loaded") {
			const p = parseKbitPayload(m.text)
			if (p && !seen.has(p.id)) {
				seen.set(p.id, p)
			}
		}
	}
	return [...seen.values()]
}

/** Compact pill for the header row. Under a narrow panel it degrades to a count — the title keeps priority. */
export const KbitPill = ({ bits, compact }: { bits: KbitLoadedPayload[]; compact?: boolean }) => {
	if (bits.length === 0) {
		return null
	}
	const authors = [...new Set(bits.filter((b) => b.attributed !== false).map((b) => b.author))]
	const lead = authors[0]
	const extra = authors.length > 1 ? ` +${authors.length - 1}` : ""
	return (
		<div
			className="mx-1 px-2 py-0.25 rounded-full inline-flex shrink-0 items-center gap-1 text-xs border"
			style={{ borderColor: "var(--vscode-panel-border)", color: "var(--vscode-descriptionForeground)" }}
			title={`${bits.length} Knowledge/Tool bit${bits.length > 1 ? "s" : ""} used this session — expand the header for the list`}>
			<KbitMark size={13} />
			{compact || !lead ? (
				<span>×{bits.length}</span>
			) : (
				<span className="whitespace-nowrap">
					<span style={{ color: BRAND_CORAL }}>
						{lead}
						{extra}
					</span>
				</span>
			)}
		</div>
	)
}

/** The roster, rendered inside the header's expanded detail area (no floating panel, no extra box). */
export const KbitRoster = ({ bits }: { bits: KbitLoadedPayload[] }) => {
	if (bits.length === 0) {
		return null
	}
	return (
		<div className="mt-2 text-xs">
			<div className="uppercase tracking-wide font-semibold text-[9px] opacity-55 mb-1">
				Knowledge & Tool bits used this session
			</div>
			<div className="flex flex-col">
				{bits.map((b) => (
					<div
						className="flex items-center gap-2 py-1"
						key={b.id}
						style={{ borderTop: "1px solid var(--vscode-panel-border)" }}>
						{b.kind === "tool" ? <TbitMark size={16} /> : <KbitMark size={16} />}
						<div className="min-w-0 flex-1">
							<div className="truncate" style={{ color: "var(--vscode-foreground)" }}>
								{b.title}
								{b.version && <span className="opacity-50 font-mono text-[10px]"> v{b.version}</span>}
							</div>
							<div className="opacity-65 text-[10.5px]">
								{b.kind === "tool" ? "Tool bit · " : ""}by {b.author}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
