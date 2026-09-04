import { type ReactNode, useState } from "react"
import { BRAND_CORAL, BRAND_CYAN_600, BRAND_CYAN_TEXT, brandAlpha } from "./brandColors"
import { KbitMark, TbitMark } from "./KbitMark"
import { authorLink } from "./kbitAuthors"

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
	/** Co-authors of the bit, in declared order — typically whoever curated the version this one grew out
	 *  of. Absent for a single-author bit, so an older payload renders exactly as before. */
	coAuthors?: string[]
	/** name → profile URL, for the names on THIS credit only. Resolved host-side, because the webview has
	 *  no network and a CSP that forbids one, and served from the registry so a contributor added after a
	 *  release is still creditable. Absent when nobody on the line has a known profile. */
	links?: Record<string, string>
	version?: string
	license?: string
	platform?: string
	steward?: string
	source?: "bundled" | "registry"
	/** Hardware evidence, when a witness record exists — rendered as a row, never as prose. */
	witness?: string
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

const KBIT_DOCS_URL = "https://docs.adsumnetworks.com/knowledge-bits"

/** SPDX ids are for machines. "LicenseRef-Adsum-P…" truncating mid-word tells a reader nothing. */
function licenseLabel(license?: string): string | null {
	if (!license) {
		return null
	}
	if (/proprietary/i.test(license)) {
		return "proprietary"
	}
	return license.replace(/-4\.0$/, "") // CC-BY-SA-4.0 → CC-BY-SA
}

const KIND_LABEL: Record<KbitLoadedPayload["kind"], string> = { knowledge: "knowledge bit", tool: "tool bit" }

/** One credit line. `bits.length > 1` groups them per the credit law (expands in place, no extra line). */
export const KbitCredit = ({ bits }: { bits: KbitLoadedPayload[] }) => {
	const [expanded, setExpanded] = useState(false)
	const [detail, setDetail] = useState<KbitLoadedPayload | null>(null)
	if (bits.length === 0) {
		return null
	}
	const authors = [...new Set(bits.map((b) => b.author))]
	// "12 bits" is not what these are called. A reader sees Knowledge bits and Tool bits; the bare noun is
	// house shorthand that leaked into the UI. Name the group by what is actually in it — and let the mark
	// follow, so a group of Tool bits does not show the Knowledge diamond.
	const kinds = new Set(bits.map((b) => b.kind))
	const groupKind: KbitLoadedPayload["kind"] = kinds.size === 1 && kinds.has("tool") ? "tool" : "knowledge"
	const groupNoun =
		kinds.size > 1
			? "Knowledge & Tool bits"
			: kinds.has("tool")
				? bits.length === 1
					? "Tool bit"
					: "Tool bits"
				: bits.length === 1
					? "Knowledge bit"
					: "Knowledge bits"

	return (
		<div className="text-[11px] mt-1.5" style={{ color: "var(--vscode-descriptionForeground)" }}>
			{bits.length === 1 ? (
				<div className="flex items-center gap-2 flex-wrap">
					<KindChip kind={bits[0].kind} />
					<span className="uppercase tracking-wide font-semibold text-[10px] opacity-70">
						{KIND_LABEL[bits[0].kind]}
					</span>
					<button
						className="bg-transparent border-0 p-0 cursor-pointer text-left text-inherit underline decoration-dotted underline-offset-2 truncate max-w-[240px]"
						onClick={() => setDetail(detail ? null : bits[0])}
						title="who curated this, and how it is maintained">
						{bits[0].title}
					</button>
					<span>
						by <AuthorName bit={bits[0]} />
					</span>
				</div>
			) : (
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2 flex-wrap">
						<KindChip kind={groupKind} />
						<span className="uppercase tracking-wide font-semibold text-[10px] opacity-70">credits</span>
						{/* text-left because a <button> centres its text by default, and this one wraps.
						    [OPERATOR 2026-09-04] "why is the text centered now, here?" — nothing centred it;
						    the browser did, the moment the author list grew past one line. Every wrapping
						    button on this surface needs the override, not just this one. */}
						<button
							className="bg-transparent border-0 p-0 cursor-pointer text-left"
							onClick={() => setExpanded(!expanded)}
							style={{ color: BRAND_CYAN_TEXT }}>
							{bits.length} {groupNoun} · by {authors.join(" + ")} {expanded ? "▴" : "▾"}
						</button>
					</div>
					{expanded &&
						bits.map((b) => (
							<div className="flex items-center gap-2 pl-[24px]" key={b.id}>
								<KindChip kind={b.kind} />
								<button
									className="bg-transparent border-0 p-0 cursor-pointer text-left text-inherit underline decoration-dotted underline-offset-2 truncate max-w-[220px]"
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

/** The Adsum diamond, cyan. Kind is carried by the mark's SHAPE, never by colour. */
const KindChip = ({ kind, size = 17 }: { kind: KbitLoadedPayload["kind"]; size?: number }) =>
	kind === "tool" ? <TbitMark size={size} /> : <KbitMark size={size} />

/**
 * A credited person. Links to their LinkedIn when we have an operator-confirmed URL (kbitAuthors.ts) and
 * renders as plain text when we do not — a missing link is honest, never a broken one, and we never guess a
 * profile from a name.
 *
 * NEVER call stopPropagation (or preventDefault) on this anchor. A VS Code webview opens external links via
 * a DELEGATED listener on document.body; React attaches its own handlers at the app root, INSIDE body, so
 * stopping propagation there means the click never reaches VS Code and the link silently does nothing — it
 * looks alive (cursor, underline, tooltip) and goes nowhere. An earlier version did exactly this to stop the
 * task header expanding when the pill was clicked; that is fixed on the header side instead, which ignores
 * clicks originating inside an <a>.
 */
/**
 * `links` comes from the registry via the host and wins, so a contributor added or corrected after this
 * build shipped still gets a link. `authorLink` is the compiled-in floor for an offline install. Neither
 * ever guesses: a name with no confirmed profile renders as plain text, which is honest rather than broken.
 */
export const PersonLink = ({ name, color, links }: { name: string; color?: string; links?: Record<string, string> }) => {
	const href = links?.[name] ?? authorLink(name)
	const tone = color ?? BRAND_CORAL
	return href ? (
		<a
			className="no-underline hover:underline"
			href={href}
			rel="noreferrer"
			style={{ color: tone }}
			target="_blank"
			title={`${name} on LinkedIn`}>
			{name}
		</a>
	) : (
		<span style={{ color: tone }}>{name}</span>
	)
}

/** Only a real, attributed person is a name; an unattributed bit says so plainly rather than inventing one. */
const AuthorName = ({ bit }: { bit: KbitLoadedPayload }) =>
	bit.attributed === false ? (
		<span className="opacity-80">{bit.author}</span>
	) : (
		<PersonLink links={bit.links} name={bit.author} />
	)

/** Co-authors on the one-line credit: the first name in full, the rest as a count the popover expands.
 *  Re-attributing a bit moves the lead name; this is what keeps the previous curator visible. */
export const CoAuthors = ({ bit, color }: { bit: KbitLoadedPayload; color?: string }) => {
	const co = bit.coAuthors ?? []
	if (co.length === 0) {
		return null
	}
	return (
		<span>
			{" with "}
			<PersonLink color={color} links={bit.links} name={co[0]} />
			{co.length > 1 ? <span className="opacity-70">{` +${co.length - 1}`}</span> : null}
		</span>
	)
}

/**
 * Provenance, one click deep. Delivery mechanics (bundled vs registry) are deliberately NOT shown — they are
 * plumbing, not provenance — and the only outbound link is the bit's public catalog entry.
 */
const ProvenanceCard = ({ bit, onClose }: { bit: KbitLoadedPayload; onClose: () => void }) => (
	<div
		className="mt-1.5 rounded-[10px] p-[11px_13px] text-[12px]"
		style={{
			border: `1px solid ${brandAlpha(BRAND_CYAN_600, 0.35)}`,
			background: "var(--vscode-editor-background)",
		}}>
		<div className="flex items-start gap-2">
			{/* 26px: above KNOT_MIN_PX, so the popover shows the real interlaced mark, not a plain diamond */}
			<KindChip kind={bit.kind} size={26} />
			<div className="flex-1 min-w-0">
				<div className="font-semibold text-[13px]" style={{ color: "var(--vscode-foreground)" }}>
					{bit.title}
				</div>
				<div className="opacity-60 text-[10px] font-mono truncate">
					{bit.id}
					{bit.version ? ` · v${bit.version}` : ""}
					{bit.platform ? ` · ${bit.platform}` : ""}
					{licenseLabel(bit.license) ? ` · ${licenseLabel(bit.license)}` : ""}
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
		{/* No prose lead. It restated CURATED BY + MAINTAINED BY directly beneath it — three renders of the
		    author in one five-line card — and read near-identically for every bit by the same author on the
		    same platform. Platform moved into the metadata line; everything factual is a labelled row. */}
		<div className="mt-[10px] flex flex-col gap-1.5">
			<ProvRow label="Curated by" muted={bit.attributed === false}>
				{bit.attributed === false ? bit.author : <PersonLink color="inherit" links={bit.links} name={bit.author} />}
			</ProvRow>
			{/* Credit is cumulative: whoever curated the version this one grew out of stays named here after
			    the lead changes hands. Absent when the bit declares no co-authors. */}
			{bit.coAuthors?.length ? (
				<ProvRow label="Co-authored by">
					{bit.coAuthors.map((name, i) => (
						<span key={name}>
							{i > 0 ? ", " : ""}
							<PersonLink color="inherit" links={bit.links} name={name} />
						</span>
					))}
				</ProvRow>
			) : null}
			{/* No signing row until signatures are real. Delegated org signing (an author's recorded approval
			    authorising Adsum to sign) is designed but not shipped, and a permanent "pending" placeholder is
			    noise on every bit forever — it reads as a defect rather than a roadmap. Restore this row when
			    signatures actually exist, showing the two facts separately (approved by X / signed: Adsum). */}
			<ProvRow label="Maintained by">{bit.steward || "Adsum Networks"}</ProvRow>
			{/* Hardware evidence is a FACT, so it gets a row like the others — and only when one exists. */}
			{bit.witness && <ProvRow label="Run on">{bit.witness}</ProvRow>}
		</div>
		{/* The provenance boundary (attribution is credit, never a statement about YOUR device) is stated in
		    the docs rather than as small print on every popover: nobody reads a credit card expecting a
		    verdict, and the UI is lint-checked at build time so it cannot render verdict language anyway. */}
		<div
			className="mt-[9px] pt-[8px] text-[10px] leading-[1.5]"
			style={{ borderTop: "1px solid var(--vscode-panel-border)" }}>
			<a href={KBIT_DOCS_URL} rel="noreferrer" style={{ color: BRAND_CYAN_TEXT }} target="_blank">
				Learn more about Knowledge bits →
			</a>
		</div>
	</div>
)

const ProvRow = ({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) => (
	<div>
		<div className="uppercase tracking-wide font-semibold text-[10px] opacity-55">{label}</div>
		<div className={muted ? "opacity-60 text-[12px]" : "text-[12px]"} style={{ color: "var(--vscode-foreground)" }}>
			{children}
		</div>
	</div>
)
