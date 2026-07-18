import { useState } from "react"

/**
 * K-bit attribution — the credit line that replaces the anonymous "read this file" row when Adsum loads a
 * Knowledge bit or Tool bit, plus the provenance popover behind it.
 *
 * Laws this implements (sprint design/01, extending the approved v2 mockup):
 *  - ONE credit line per turn, first use only. Repeat loads emit nothing (the host dedupes) — a long
 *    session's transcript stays the size it is today.
 *  - Attribution, never a verdict. No "certified/verified/approved"; no green; `tier` never rendered.
 *    Signing shows the honest interim state until real signatures exist.
 *  - The chat never links bit content and never shows tree paths — one public catalog entry per bit.
 *    The knowledge tree's shape is itself IP, and this holds when bits are later encrypted.
 */

export interface KbitLoadedPayload {
	id: string
	title: string
	kind: "knowledge" | "tool"
	author: string
	attributed?: boolean
	version?: string
	license?: string
	platform?: string
	steward?: string
	source?: "bundled" | "registry"
	lead?: string
}

export function parseKbitPayload(text: string | undefined): KbitLoadedPayload | null {
	if (!text) {
		return null
	}
	try {
		const p = JSON.parse(text) as KbitLoadedPayload
		return p && p.id ? p : null
	} catch {
		return null
	}
}

const KIND_LABEL: Record<KbitLoadedPayload["kind"], string> = { knowledge: "knowledge bit", tool: "tool bit" }
const KIND_GLYPH: Record<KbitLoadedPayload["kind"], string> = { knowledge: "◆", tool: "⚙" }

/** Kind colours match the corpus graph in Studio: knowledge = violet, tool = cyan. */
function kindStyle(kind: KbitLoadedPayload["kind"]): React.CSSProperties {
	return kind === "tool"
		? { background: "color-mix(in srgb, var(--vscode-charts-blue) 16%, transparent)", color: "var(--vscode-charts-blue)" }
		: {
				background: "color-mix(in srgb, var(--vscode-charts-purple) 16%, transparent)",
				color: "var(--vscode-charts-purple)",
			}
}

/** One credit line. `bits.length > 1` groups them per the credit law (expands in place, no extra line). */
export const KbitCredit = ({ bits }: { bits: KbitLoadedPayload[] }) => {
	const [expanded, setExpanded] = useState(false)
	const [detail, setDetail] = useState<KbitLoadedPayload | null>(null)
	if (bits.length === 0) {
		return null
	}
	const authors = [...new Set(bits.map((b) => b.author))]

	return (
		<div className="text-[11px] mt-[6px]" style={{ color: "var(--vscode-descriptionForeground)" }}>
			{bits.length === 1 ? (
				<div className="flex items-center gap-[7px] flex-wrap">
					<KindChip kind={bits[0].kind} />
					<span className="uppercase tracking-wide font-semibold text-[8.5px] opacity-70">
						{KIND_LABEL[bits[0].kind]}
					</span>
					<button
						className="bg-transparent border-0 p-0 cursor-pointer text-inherit underline decoration-dotted underline-offset-2 truncate max-w-[240px]"
						onClick={() => setDetail(detail ? null : bits[0])}
						title="who curated this, and how it is maintained">
						{bits[0].title}
					</button>
					<span>
						by <AuthorName bit={bits[0]} />
					</span>
				</div>
			) : (
				<div className="flex flex-col gap-[4px]">
					<div className="flex items-center gap-[7px] flex-wrap">
						<KindChip kind="knowledge" />
						<span className="uppercase tracking-wide font-semibold text-[8.5px] opacity-70">credits</span>
						<button
							className="bg-transparent border-0 p-0 cursor-pointer"
							onClick={() => setExpanded(!expanded)}
							style={{ color: "var(--vscode-textLink-foreground)" }}>
							{bits.length} bits · by {authors.join(" + ")} {expanded ? "▴" : "▾"}
						</button>
					</div>
					{expanded &&
						bits.map((b) => (
							<div className="flex items-center gap-[7px] pl-[24px]" key={b.id}>
								<KindChip kind={b.kind} />
								<button
									className="bg-transparent border-0 p-0 cursor-pointer text-inherit underline decoration-dotted underline-offset-2 truncate max-w-[220px]"
									onClick={() => setDetail(detail?.id === b.id ? null : b)}>
									{b.title}
								</button>
								{b.version && <span className="opacity-60">v{b.version}</span>}
							</div>
						))}
				</div>
			)}
			{detail && <ProvenanceCard bit={detail} onClose={() => setDetail(null)} />}
		</div>
	)
}

const KindChip = ({ kind }: { kind: KbitLoadedPayload["kind"] }) => (
	<span
		className="inline-grid place-items-center rounded-[4px] text-[9.5px] shrink-0"
		style={{ width: 17, height: 17, ...kindStyle(kind) }}>
		{KIND_GLYPH[kind]}
	</span>
)

/** Only a real, attributed person is a name; an unattributed bit says so plainly rather than inventing one. */
const AuthorName = ({ bit }: { bit: KbitLoadedPayload }) =>
	bit.attributed === false ? (
		<span className="opacity-80">{bit.author}</span>
	) : (
		<span style={{ color: "var(--vscode-charts-orange)" }}>{bit.author}</span>
	)

/**
 * Provenance, one click deep. Delivery mechanics (bundled vs registry) are deliberately NOT shown — they are
 * plumbing, not provenance — and the only outbound link is the bit's public catalog entry.
 */
const ProvenanceCard = ({ bit, onClose }: { bit: KbitLoadedPayload; onClose: () => void }) => (
	<div
		className="mt-[6px] rounded-[10px] p-[11px_13px] text-[11.5px]"
		style={{
			border: "1px solid var(--vscode-panel-border)",
			background: "var(--vscode-editor-background)",
		}}>
		<div className="flex items-start gap-[9px]">
			<KindChip kind={bit.kind} />
			<div className="flex-1 min-w-0">
				<div className="font-semibold text-[12.5px]" style={{ color: "var(--vscode-foreground)" }}>
					{bit.title}
				</div>
				<div className="opacity-60 text-[10px] font-mono truncate">
					{bit.id}
					{bit.version ? ` · v${bit.version}` : ""}
					{bit.license ? ` · ${bit.license}` : ""}
				</div>
			</div>
			<button
				aria-label="close"
				className="bg-transparent border-0 cursor-pointer opacity-70"
				onClick={onClose}
				style={{ color: "inherit" }}>
				✕
			</button>
		</div>
		{bit.lead && <div className="mt-[8px] leading-[1.55] opacity-90">{bit.lead}</div>}
		<div className="mt-[9px] flex flex-col gap-[6px]">
			<ProvRow label="Curated by" muted={bit.attributed === false} value={bit.author} />
			{/* Delegated org signing: an author's recorded approval authorises Adsum to sign. Until signatures
			    actually ship this states the honest interim fact rather than claiming a signature. */}
			<ProvRow label="Reviewed & signed" muted value="review recorded · signature pending" />
			<ProvRow label="Maintained by" value={bit.steward || "Adsum Networks"} />
		</div>
		<div
			className="mt-[9px] pt-[8px] text-[10px] leading-[1.5] opacity-60"
			style={{ borderTop: "1px solid var(--vscode-panel-border)" }}>
			<b>Attribution, not a verdict.</b> Adsum shows you who built this expertise and how it was proven — then describes
			evidence and tells you what to verify. It never certifies your device.
		</div>
	</div>
)

const ProvRow = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
	<div>
		<div className="uppercase tracking-wide font-semibold text-[9px] opacity-55">{label}</div>
		<div className={muted ? "opacity-60 text-[12px]" : "text-[12px]"} style={{ color: "var(--vscode-foreground)" }}>
			{value}
		</div>
	</div>
)
