import { createHash, createPublicKey, verify as edVerify } from "node:crypto"

/**
 * Client-side verification of a published version's steward signature.
 *
 * The digest must be computed exactly as the server computes it (see Adsum-Backend
 * src/services/signing.ts): sha256 over id, version, content_hash and the SORTED artifact hashes.
 * Sorted, because member order in frontmatter is cosmetic.
 *
 * The point of checking here rather than trusting the registry: a compromised registry can serve any
 * bytes it likes, but it cannot produce a signature for them — the steward's private key never
 * leaves the steward's machine. So this is the check that turns "the hashes matched what the
 * manifest said" into "a steward approved exactly this".
 */

/**
 * Public keys this build accepts. A release ships the current key plus, during a rotation, the
 * previous one — old signatures stay valid because a signature is per version, not per key epoch.
 * Empty ⇒ this build does not yet enforce signatures.
 */
export const PINNED_STEWARD_KEYS: string[] = []

export interface SignedVersion {
	id: string
	version: string
	content_hash?: string
	artifacts?: Array<{ sha256?: unknown }>
	signature?: string | null
	signed_by?: string | null
}

export function signingDigest(v: SignedVersion): string {
	const arts = (v.artifacts ?? []).map((a) => String(a?.sha256 ?? "")).filter(Boolean)
	return createHash("sha256")
		.update([v.id, v.version, v.content_hash ?? "", ...arts.sort()].join("\n"), "utf8")
		.digest("hex")
}

export type SignatureVerdict = "ok" | "unsigned" | "bad" | "not-enforced"

/**
 * Verdicts, and what a caller should do:
 *   not-enforced — this build pins no keys yet; proceed (the pre-signing world).
 *   ok           — a pinned steward key signed exactly this version; proceed.
 *   unsigned     — keys are pinned but the version carries no signature; DO NOT run it.
 *   bad          — a signature is present and does not verify; DO NOT run it, and say so loudly.
 */
export function verifyVersionSignature(v: SignedVersion, keys: string[] = PINNED_STEWARD_KEYS): SignatureVerdict {
	if (keys.length === 0) {
		return "not-enforced"
	}
	if (!v.signature) {
		return "unsigned"
	}
	const digest = signingDigest(v)
	let sig: Buffer
	try {
		sig = Buffer.from(v.signature, "base64")
	} catch {
		return "bad"
	}
	for (const pem of keys) {
		try {
			if (edVerify(null, Buffer.from(digest, "utf8"), createPublicKey(pem), sig)) {
				return "ok"
			}
		} catch {
			// a malformed pinned key must not prevent the others being tried
		}
	}
	return "bad"
}

/** True when a version is safe to materialise and run. */
export const signatureAllowsRun = (verdict: SignatureVerdict): boolean => verdict === "ok" || verdict === "not-enforced"

/**
 * Whether this build enforces signatures at all — i.e. whether any key is pinned.
 *
 * Signing ships as a complete feature with enforcement OFF: the operator's call, until the
 * implications for every author's publish flow are understood. The precedence rule consults this to
 * decide whether replacing VSIX content additionally requires a valid signature. Turning enforcement
 * on is one edit — pin a key in `PINNED_STEWARD_KEYS` — and nothing else in the client changes.
 */
export function signatureEnforcementState(): "ok" | "not-enforced" {
	return PINNED_STEWARD_KEYS.length > 0 ? "ok" : "not-enforced"
}
