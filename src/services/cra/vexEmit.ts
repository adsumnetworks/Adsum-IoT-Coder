/**
 * OpenVEX emitter (CVE scan loop — design/15 §7/§8; red-team finding #1). Produces the `compliance/vex.json`
 * the developer hands back to a compliance team — the conformity STATUS the host must never assert itself.
 *
 * Guardrails that make "the dev asserts, not us" true in the bytes:
 *  - HARD attestation gate: `buildVex` THROWS unless `attested === true` (no unattested vex.json is ever written).
 *  - `author` = the manufacturer; `tooling` = Adsum (we are the mechanism, not the asserter).
 *  - OpenVEX requires a justification for `not_affected` — enforced here.
 * Pure; the timestamp is injected. The output is scanned in `verdictScan` VEX-mode (status tokens allowed there,
 * still banned in prose) — see the honesty suite.
 */

export type VexStatus = "affected" | "not_affected" | "fixed" | "under_investigation"

/** OpenVEX justification labels valid for `not_affected`. */
export type VexJustification =
	| "component_not_present"
	| "vulnerable_code_not_present"
	| "vulnerable_code_not_in_execute_path"
	| "vulnerable_code_cannot_be_controlled_by_adversary"
	| "inline_mitigations_already_exist"

export interface VexStatement {
	vulnId: string
	status: VexStatus
	/** REQUIRED when status === "not_affected" (OpenVEX). */
	justification?: VexJustification
	notes?: string
}

export interface VexInput {
	/** The manufacturer/developer asserting — the VEX author (NEVER "Adsum"). */
	author: string
	/** Product identifier (purl or product name). */
	product: string
	statements: VexStatement[]
	/** ISO timestamp, injected by the caller. */
	timestamp: string
	/** HARD GATE — vex.json is produced ONLY when the human has explicitly attested. */
	attested: boolean
}

export class VexAttestationError extends Error {}

export interface OpenVexDoc {
	"@context": string
	"@id": string
	author: string
	role: string
	timestamp: string
	tooling: string
	statements: Array<{
		vulnerability: { name: string }
		products: Array<{ "@id": string }>
		status: VexStatus
		justification?: VexJustification
		status_notes?: string
	}>
}

/** Build the OpenVEX doc. THROWS if not attested, or if a not_affected statement lacks a justification. */
export function buildVex(input: VexInput): OpenVexDoc {
	if (!input.attested) {
		throw new VexAttestationError(
			"VEX requires an explicit manufacturer attestation — refusing to emit an unattested conformity status.",
		)
	}
	for (const s of input.statements) {
		if (s.status === "not_affected" && !s.justification) {
			throw new VexAttestationError(`OpenVEX requires a justification for not_affected (${s.vulnId}).`)
		}
	}
	return {
		"@context": "https://openvex.dev/ns/v0.2.0",
		"@id": `urn:adsum:vex:${input.product}:${input.timestamp}`,
		author: input.author, // the manufacturer asserts — NOT Adsum
		role: "Manufacturer",
		timestamp: input.timestamp,
		tooling: "Adsum IoT Coder (scan + evidence assistance)", // Adsum is the tool, not the asserter
		statements: input.statements.map((s) => ({
			vulnerability: { name: s.vulnId },
			products: [{ "@id": input.product }],
			status: s.status,
			...(s.justification ? { justification: s.justification } : {}),
			...(s.notes ? { status_notes: s.notes } : {}),
		})),
	}
}

/** Serialize the bytes written to compliance/vex.json — only ever past buildVex's attestation gate. */
export function emitVexJson(input: VexInput): string {
	return JSON.stringify(buildVex(input), null, 2)
}
