import { semverLt } from "@/services/knowledge/kbit/schema"

/**
 * Which copy of a bit wins — the one rule, shared by the knowledge resolver and the tool resolver.
 *
 * Until 0.3.0 both resolvers said "bundled always wins on an id clash". That made the registry a
 * place to publish NEW bits and nothing else: improving a bit that already shipped in the VSIX meant
 * shipping a new VSIX. The rule is now **registry-newer-wins** — if the catalog offers a newer version
 * of the same id and this extension can run it, that copy is preferred, and the bundled copy is the
 * last resort.
 *
 * "Last resort" is the load-bearing half. Every way the registry copy can fail to be trustworthy —
 * offline with nothing cached, a fetch that never arrives, a hash that does not match, a signature
 * that does not verify (when enforcement is on), a descriptor missing the fields needed to run it —
 * lands on the bundled copy the developer already has. A registry outage must cost nobody their tools,
 * so this function never returns "nothing": for an id that is bundled, the answer is always a copy.
 *
 * Pure and synchronous by design. It decides *which* copy; the caller does the I/O and comes back
 * through `fallback()` if that I/O fails, so there is exactly one place where the fallback reasons
 * are enumerated and exactly one place they can be tested.
 */

/** Why the bundled copy was chosen. Every value is a reason NOT to trust the registry copy. */
export type PrecedenceReason =
	/** The catalog has no row for this id at all — the normal case for a bundled-only bit. */
	| "no-registry-row"
	/** The id is on the exempt list: something reads it synchronously and cannot await a fetch. */
	| "exempt"
	/** A version string that is not MAJOR.MINOR.PATCH. Never guess at ordering. */
	| "bad-version"
	/** The registry copy is the same version or older. */
	| "not-newer"
	/** The registry copy declares a floor this extension does not meet. */
	| "min_ext-unmet"
	/** The registry copy is deprecated or revoked. */
	| "status"
	/** A tool row without the fields needed to actually run it. */
	| "incomplete-descriptor"
	/** A python tool whose bundle has no launcher for this platform. */
	| "no-launcher"
	/** Signature enforcement is on and this copy does not verify. */
	| "unsigned"
	// ── reasons the caller reports back after doing the I/O ──
	/** Verification could not be performed. */
	| "unverified"
	/** The registry could not be reached, or the blob never arrived. */
	| "fetch-failed"
	/** The bytes arrived but did not match the declared hash. */
	| "hash-failed"
	/** The bytes arrived but could not be parsed. */
	| "parse-failed"
	/** Offline, and this copy is not in the on-disk cache (a proprietary bit is never cached). */
	| "offline-uncached"
	/** The bundled copy itself could not be read — reported so a caller can log it. */
	| "unreadable"

export type PrecedenceChoice<B, R> =
	/** A dev-only local file (`ADSUM_KBIT_LOCAL`) — an author editing a bit under F5. */
	| { copy: "local"; path: string }
	/** The registry copy. The caller must still verify it and may come back through `fallback()`. */
	| { copy: "registry"; row: R }
	/** The copy that shipped in the VSIX. `entry` is null only when nothing is bundled either. */
	| { copy: "bundled"; entry: B | null; reason: PrecedenceReason }

export interface PrecedenceCtx<R> {
	/** The installed extension version, INJECTED — the resolvers must not import `src/registry.ts`. */
	extVersion: string
	/**
	 * Whether signature enforcement is switched on. Signing ships as a feature but stays off until the
	 * steward keys are pinned; while it is off, an override is trusted on hash verification plus the
	 * steward-approved publish, which is the same trust the registry already carries for every
	 * downloaded bit. When it is switched on, overriding VSIX content is held to the higher bar.
	 */
	enforcement: "ok" | "not-enforced"
	/** Absolute path of a dev local-override file for this id, if there is one and IS_DEV is true. */
	localPath?: string
	/** Ids something resolves synchronously and therefore may never be overridden. */
	exempt?: ReadonlySet<string>
	/** Tool rows carry extra requirements a knowledge row does not. */
	kind?: "bit" | "tool"
	/** Signature verdict for a tool row. Consulted only when `enforcement` is "ok". */
	signatureOk?: (row: R) => boolean
	/** Whether a python tool's bundle carries a launcher for the running platform. */
	hasPlatformLauncher?: (row: R) => boolean
}

const SEMVER = /^\d+\.\d+\.\d+$/

/** A field is only usable if it really is a string — catalog rows are `unknown`-typed JSON. */
function str(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined
}

/** Every field a tool row must carry before it can replace a tool the developer already has. */
const TOOL_REQUIRED = ["runtime", "entry", "usage", "artifacts", "readonly", "safety"] as const

function toolDescriptorComplete(row: Record<string, unknown>): boolean {
	for (const f of TOOL_REQUIRED) {
		const v = row[f]
		if (v === undefined || v === null) {
			return false
		}
	}
	return Array.isArray(row.artifacts) && row.artifacts.length > 0
}

/**
 * Decide which copy of `id` to use.
 *
 * `bundled` is the manifest entry (null if this id is registry-only) and `registryRow` is the catalog
 * row (null if the catalog does not carry it). Both may be null — then there is nothing to choose and
 * the caller has a genuinely unknown id.
 *
 * The gates only run when BOTH copies exist. They are about whether to replace something the developer
 * already has; a registry-only bit has no alternative, so gating it would only make it unavailable.
 */
export function choose<B extends { version?: string }, R extends Record<string, unknown>>(
	id: string,
	bundled: B | null,
	registryRow: R | null,
	ctx: PrecedenceCtx<R>,
): PrecedenceChoice<B, R> {
	// 1. A local override is the author's own working copy. It outranks everything, and it only exists
	//    in a dev build — the branch is compiled out of the shipped extension.
	if (ctx.localPath) {
		return { copy: "local", path: ctx.localPath }
	}

	if (!registryRow) {
		return { copy: "bundled", entry: bundled, reason: "no-registry-row" }
	}

	// 2. Nothing is bundled: the registry copy is the ONLY copy, so it is the answer. Every gate below
	//    exists to protect content the developer already has — applying them here would not make an
	//    ordinary downloaded bit safer, it would make it unavailable. This is the pre-0.3.0 behaviour
	//    for every registry-only bit, unchanged.
	if (!bundled) {
		return { copy: "registry", row: registryRow }
	}

	// 3. Some ids are read synchronously (the demo builder cannot await a fetch), so an override would
	//    give one install two different versions of the same bit depending on who asked.
	if (ctx.exempt?.has(id)) {
		return { copy: "bundled", entry: bundled, reason: "exempt" }
	}

	const rowVersion = str(registryRow.version)
	const bundledVersion = bundled ? str(bundled.version) : undefined

	// 4. Junk in either version means we cannot order them. Refusing to guess is the point: a
	//    prerelease tag reads as "equal" to any 3-part comparator, so it must never win by accident.
	if (!rowVersion || !SEMVER.test(rowVersion) || !bundledVersion || !SEMVER.test(bundledVersion)) {
		return { copy: "bundled", entry: bundled, reason: "bad-version" }
	}

	// 5. min_ext is re-checked HERE, client-side, on every row — not just trusted from the server's
	//    filter. The cached catalog outlives the extension that fetched it: a catalog pulled by 0.3.2
	//    and read offline by 0.3.0 still carries rows 0.3.0 cannot run.
	const minExt = str(registryRow.min_ext)
	if (!ctx.extVersion || !SEMVER.test(ctx.extVersion)) {
		return { copy: "bundled", entry: bundled, reason: "min_ext-unmet" }
	}
	if (minExt && semverLt(ctx.extVersion, minExt)) {
		return { copy: "bundled", entry: bundled, reason: "min_ext-unmet" }
	}

	// 6. A tombstone in the catalog must never replace healthy shipped content.
	const status = str(registryRow.status)
	if (status === "deprecated" || status === "revoked") {
		return { copy: "bundled", entry: bundled, reason: "status" }
	}

	if (ctx.kind === "tool") {
		// 7. A row missing `readonly`/`safety` would silently change whether the tool asks for approval;
		//    a row missing `entry`/`artifacts` cannot be run at all. A stale-but-complete tool beats a
		//    newer one that degrades its own advertisement.
		if (!toolDescriptorComplete(registryRow)) {
			return { copy: "bundled", entry: bundled, reason: "incomplete-descriptor" }
		}
		// 8. The python launchers carry the interpreter probe and the user-site fix. An override that
		//    drops the launcher for this platform would quietly run a different command line.
		if (ctx.hasPlatformLauncher && !ctx.hasPlatformLauncher(registryRow)) {
			return { copy: "bundled", entry: bundled, reason: "no-launcher" }
		}
	}

	// 9. When enforcement is on, replacing content that arrived inside a signed VSIX takes a signature.
	//    Hash verification proves the registry is self-consistent; it does not prove who published.
	if (ctx.enforcement === "ok" && ctx.signatureOk && !ctx.signatureOk(registryRow)) {
		return { copy: "bundled", entry: bundled, reason: "unsigned" }
	}

	// 10. Ordering last, so that an unrunnable newer row is rejected for the reason that actually
	//    disqualifies it rather than being reported as "not newer".
	if (!semverLt(bundledVersion, rowVersion)) {
		return { copy: "bundled", entry: bundled, reason: "not-newer" }
	}

	return { copy: "registry", row: registryRow }
}

/**
 * The caller's way back after the I/O it was told to do did not work out.
 *
 * Kept here so that "what happens when a fetch fails" is answered in the same file as "which copy do
 * we prefer" — the two halves drifting apart is how a hash failure once turned a working bundled bit
 * into an empty string.
 */
export function fallback<B, R>(bundled: B | null, reason: PrecedenceReason): PrecedenceChoice<B, R> {
	return { copy: "bundled", entry: bundled, reason }
}

/** Human-readable, for the one console line each fallback emits. Never shown to the developer as UI. */
export function reasonText(reason: PrecedenceReason): string {
	switch (reason) {
		case "no-registry-row":
			return "not in the registry"
		case "exempt":
			return "id is resolved synchronously and cannot be overridden"
		case "bad-version":
			return "version is not MAJOR.MINOR.PATCH"
		case "not-newer":
			return "registry copy is not newer"
		case "min_ext-unmet":
			return "registry copy needs a newer extension"
		case "status":
			return "registry copy is deprecated or revoked"
		case "incomplete-descriptor":
			return "registry descriptor is missing fields needed to run it"
		case "no-launcher":
			return "registry bundle has no launcher for this platform"
		case "unsigned":
			return "registry copy is not signed by a pinned steward key"
		case "unverified":
			return "registry copy could not be verified"
		case "fetch-failed":
			return "registry unreachable"
		case "hash-failed":
			return "registry copy failed hash verification"
		case "parse-failed":
			return "registry copy could not be parsed"
		case "offline-uncached":
			return "registry override unavailable offline"
		case "unreadable":
			return "bundled copy could not be read"
	}
}
