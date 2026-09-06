import { z } from "zod"

/**
 * Canonical K-bit frontmatter schema — see `iot-knowledge/KBIT-SPEC.md`.
 *
 * This is the single source of truth, consumed by:
 *  - the linter (`scripts/kbit-lint.ts`),
 *  - the runtime Knowledge Resolver (P0b),
 *  - the authoring wizard (P1),
 *  - the Node backend registry (P2).
 *
 * The JSON Schema artifact `iot-knowledge/kbit.schema.json` is GENERATED from this
 * file via `npm run gen:kbit-schema` (do not hand-edit the JSON; CI checks it is in sync).
 */

export const KBIT_TYPES = ["workflow", "action", "knowledge", "tool"] as const
export const KBIT_OWNERS = ["adsum-core", "adsum-extended", "community", "partner"] as const
export const KBIT_TIERS = ["community", "certified"] as const
export const KBIT_DELIVERY = ["bundled", "downloaded"] as const
export const KBIT_PLATFORMS = ["nrf", "esp", "universal"] as const
export const KBIT_SAFETY = ["shell", "flash", "erase", "network", "fs-write", "process-kill", "long-running"] as const
// Lifecycle status (R4.1). Absent ⇒ treated as "published" by consumers. Enforcement (revocation,
// transitions) is P2 — in P1 this is a declared, forward-compatible field.
export const KBIT_STATUS = ["draft", "published", "deprecated", "revoked"] as const
// Commercial axis, DELIBERATELY separate from `delivery` (which is distribution). Absent ⇒ "free",
// so every bit published before this field existed stays free by construction — the no-rug-pull rule
// enforced by the default rather than by an audit.
export const KBIT_ACCESS = ["free", "pro"] as const
// Entitlement groups — the ENTITLEMENT axis, separate again from `access` and `delivery`.
//
// `access` says a bit is commercial; `group` says WHICH entitlement unlocks it, and entitlements are
// granted to accounts, never derived from a version. That distinction is the whole design: `min_ext`
// remains a compatibility floor (a client older than 0.4.0 reports a 402 as "bit missing", so a gated
// bit must not reach one), and who may read a bit is an assignment the operator makes — by hand from
// the admin page today, by a purchase webhook later, writing the same row either way.
//
// ABSENT ⇒ free to everyone, which keeps the no-rug-pull rule true by construction for every bit
// published before this field existed.
export const KBIT_GROUPS = [
	// knowledge
	"cellular-advanced", // LTE-M / NB-IoT / NTN / DECT NR+ beyond chip-and-DK basics
	"edge-ai-advanced", // on-device inference (nRF54 Axon)
	// Fanstel LEW840x gateway artefacts
	"lew840x-demo-hex", // the three signed demo hexes (cellular capped at 60 min per boot)
	"lew840x-prod-hex", // the same builds without the cap — granted by hand for pilots
	"lew840x-ble-src",
	"lew840x-esp-src",
	"lew840x-9160-src",
	// Fanstel BLG20 gateway artefacts (same ladder, published as the port lands)
	"blg20-demo-hex",
	"blg20-prod-hex",
	"blg20-ble-src",
	"blg20-esp-src",
	"blg20-9151-src",
	// staff / partner catch-all: holding it satisfies every other group
	"all",
] as const
// How a tool bit's entry point is executed. `node` runs under VS Code's own Node (process.execPath),
// so it needs nothing installed — the default choice for new tools. `python3` needs a system
// interpreter (probed at resolve time, and said so in the advertisement when missing).
// `host` is the odd one: it describes a tool that is COMPILED INTO the extension — the three built-in
// doors (triggerEspAction, triggerNordicAction, triggerCveScan). It has no artifacts and is never
// downloadable. It exists so those doors are visible in the graph, creditable to their authors and
// linkable from the ~20 procedures that drive them, which until now could point at nothing.
export const KBIT_RUNTIMES = ["python3", "node", "wasm", "native", "host"] as const

// The first extension release that can resolve a tool bit, and the first that tells a 402 from a 404.
// A bit that needs either capability must floor `min_ext` at or above the matching constant, or the
// registry would hand it to a client that cannot understand it. Mirrored server-side in
// Adsum-Backend `src/services/compatRules.ts` — change both together.
export const TOOL_BITS_MIN_EXT = "0.3.0"
export const PRO_AWARE_MIN_EXT = "0.4.0"

/** a < b for MAJOR.MINOR.PATCH (missing parts = 0, junk = 0). */
export function semverLt(a: string, b: string): boolean {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0)
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0)
	for (let i = 0; i < 3; i++) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) {
			return (pa[i] ?? 0) < (pb[i] ?? 0)
		}
	}
	return false
}

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, "version must be MAJOR.MINOR.PATCH (semver)")
const bitId = z
	.string()
	.regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/i, "id must be a namespaced slug, e.g. adsum/nrf/workflows/add-feature")
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

// Credibility / contribution roles (R5.x). A `handle` is a stable identity slug; `name`/`affiliation`
// are for display. In P1 these are DECLARED only — the registry verifies them in P2 (see `verified`).
const creditEntry = z
	.object({ handle: z.string().min(1), name: z.string().min(1).optional(), affiliation: z.string().min(1).optional() })
	.strict()
// An endorsement is VERSION-PINNED: an expert vouches for a specific bit version (re-endorse on a
// material change). `verified` stays false until the P2 registry authenticates the endorser.
const endorsementEntry = z
	.object({
		handle: z.string().min(1),
		name: z.string().min(1).optional(),
		affiliation: z.string().min(1).optional(),
		version: semver,
		date: isoDate,
		verified: z.boolean().default(false),
		statement: z.string().min(1).optional(),
	})
	.strict()
const supporterEntry = z
	.object({
		handle: z.string().min(1),
		name: z.string().min(1).optional(),
		affiliation: z.string().min(1).optional(),
		kind: z.enum(["sponsor", "backer"]).default("sponsor"),
	})
	.strict()

// One file inside a tool bit's artifact bundle. `path` is relative to the bit's directory and is
// attacker-controlled on the download path, so it is constrained here as well as server-side: no
// traversal, no absolute paths, no backslashes. `sha256` is over the RAW BYTES — never a
// CRLF-normalised body, which is how k-bit prose is hashed.
const artifactEntry = z
	.object({
		path: z
			.string()
			.regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/, "artifact path must be a relative slug path (no .., no /, no \\)")
			.refine((s) => !s.split("/").includes(".."), { message: "artifact path may not contain .." }),
		sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
		// Only for `runtime: native`, where one bundle carries a build per platform.
		platform: z.enum(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"]).optional(),
		// Entitlement for THIS member, when a bundle mixes payloads: the gateway seeds ship a free
		// no-LTE variant beside a demo hex and licensed source, and they are one bit with one history.
		// Absent ⇒ the bit's own `group` applies, and if that is absent too, the member is free.
		group: z.enum(KBIT_GROUPS).optional(),
	})
	.strict()

export const kbitMetaSchema = z
	.object({
		id: bitId,
		title: z.string().min(1),
		type: z.enum(KBIT_TYPES),
		version: semver,
		owner: z.enum(KBIT_OWNERS),
		author: z.string().min(1),
		license: z.string().min(1),
		tier: z.enum(KBIT_TIERS),
		delivery: z.enum(KBIT_DELIVERY),
		domain: z.string().min(1),
		platform: z.enum(KBIT_PLATFORMS).optional(),
		triggers: z.array(z.string().min(1)).optional(),
		soc: z.array(z.string().min(1)).optional(),
		sdk: z.string().min(1).optional(),
		sdk_version: z.string().min(1).optional(),
		requires: z.array(bitId).optional(),
		loaded_by: z.array(bitId).optional(),
		last_verified: z
			.object({ date: isoDate, env: z.string().min(1) })
			.strict()
			.optional(),
		safety: z.array(z.enum(KBIT_SAFETY)).optional(),
		supersedes: bitId.optional(),
		// Backward-compatibility gate (registry serving). The MINIMUM extension version this bit version
		// needs — set it ONLY when the bit depends on a host capability older apps lack (a new tool, a bit
		// that doesn't exist yet). ABSENT ⇒ universal: compatible with every release (the default — pure-prose
		// bits never set it). The registry serves each client the latest version whose `min_ext` ≤ the client's
		// app version, so a host-dependent bump never reaches an app that can't run it. See the kbit-handbook
		// "safe publishing & backward-compat" section.
		min_ext: semver.optional(),
		// The MINIMUM nRF Connect SDK version this bit's content is valid for. Distinct from `min_ext`,
		// which gates on the EXTENSION version: a bit can be perfectly servable to this app yet describe a
		// board target or feature that does not exist in the developer's installed SDK. Set it on board and
		// SoC bits (e.g. the XIAO nRF54LM20A needs NCS >= 3.3.0); leave it absent for prose that is version
		// independent. The host compares it against the detected toolchain and warns BEFORE the agent spends
		// a build cycle discovering the board does not resolve.
		min_ncs: semver.optional(),
		content_hash: z.string().optional(),
		// ── commercial + executable fields ───────────────────────────────────────────────────────
		// Absent ⇒ free. See KBIT_ACCESS.
		access: z.enum(KBIT_ACCESS).optional(),
		// Which entitlement unlocks this bit. Absent ⇒ nobody needs anything. See KBIT_GROUPS.
		group: z.enum(KBIT_GROUPS).optional(),
		// ── tool bits (`type: tool`) ─────────────────────────────────────────────────────────────
		// A tool bit is this descriptor plus a bundle of files. The host materialises the bundle,
		// writes a launcher, and advertises `<launcher> <usage>` in the prompt; the model runs it with
		// `execute_command`. No compiled host handler is involved.
		runtime: z.enum(KBIT_RUNTIMES).optional(),
		/** Entry file, which must be one of `artifacts[].path`. */
		entry: z.string().min(1).optional(),
		/** For `runtime: host` only: the registered ClineDefaultTool name the model actually sees. */
		host_tool: z.string().min(1).optional(),
		/** The argument line shown to the model, e.g. `--decode <trace.bin> --out <dir>`. */
		usage: z.string().min(1).optional(),
		artifacts: z.array(artifactEntry).optional(),
		/** External executables the tool shells out to (e.g. nrfutil). Probed; absence is advertised. */
		requires_tools: z.array(z.string().min(1)).optional(),
		/** True ⇒ the tool only reads. Combined with an empty `safety`, this is what makes a tool
		 *  eligible for auto-approval; anything that flashes, erases, kills or reaches the network is not. */
		readonly: z.boolean().optional(),
		timeout_s: z.number().int().positive().max(3600).optional(),
		// Credibility roles (R5.x). `author` above stays the primary author (back-compat).
		co_authors: z.array(creditEntry).optional(),
		endorsers: z.array(endorsementEntry).optional(),
		supporters: z.array(supporterEntry).optional(),
		// Lifecycle (R4.1/R4.2). `created`/`updated` are author hints; git history is authoritative
		// for bundled bits until the registry (P2).
		status: z.enum(KBIT_STATUS).optional(),
		created: isoDate.optional(),
		updated: isoDate.optional(),
	})
	.strict()
	// Workflows are the only bits routed by intent → they must declare triggers.
	.refine((d) => d.type !== "workflow" || (d.triggers !== undefined && d.triggers.length > 0), {
		message: "workflows must declare at least one trigger",
		path: ["triggers"],
	})
	// Actions are workflow-invoked and knowledge is referenced → neither may declare triggers.
	.refine((d) => d.type === "workflow" || d.triggers === undefined, {
		message: "only workflows may declare triggers",
		path: ["triggers"],
	})
	// No self-endorsement (R5.3): an endorser may not also be the author or a co-author.
	.refine(
		(d) => {
			if (!d.endorsers?.length) {
				return true
			}
			const authorHandles = new Set([d.author, ...(d.co_authors?.map((c) => c.handle) ?? [])])
			return d.endorsers.every((e) => !authorHandles.has(e.handle))
		},
		{ message: "an endorser cannot be the author or a co-author (no self-endorsement)", path: ["endorsers"] },
	)
	// A tool bit is a descriptor for something executable — without a runtime, an entry point and the
	// bundle it lives in, there is nothing to run.
	.refine((d) => d.type !== "tool" || d.runtime === "host" || (!!d.runtime && !!d.entry && !!d.artifacts?.length), {
		message: "a tool bit must declare runtime, entry and at least one artifact",
		path: ["runtime"],
	})
	// A host tool is the extension's own code. Naming an entry or an artifact would promise a bundle
	// that does not exist and cannot be fetched; naming the registered tool is the whole descriptor.
	.refine((d) => d.runtime !== "host" || (!d.entry && !d.artifacts?.length), {
		message: "a host tool has no entry and no artifacts — it is compiled into the extension",
		path: ["runtime"],
	})
	.refine((d) => d.runtime !== "host" || !!d.host_tool, {
		message: "a host tool must declare host_tool (the registered tool name the model is given)",
		path: ["host_tool"],
	})
	// Bundled by construction: there is nothing to serve, so a downloadable host tool would be a
	// descriptor promising code the registry does not have.
	.refine((d) => d.runtime !== "host" || d.delivery === "bundled", {
		message: "a host tool must be delivery: bundled — the registry has nothing to serve for it",
		path: ["delivery"],
	})
	.refine((d) => !d.host_tool || d.runtime === "host", {
		message: "host_tool is only valid on a runtime: host tool bit",
		path: ["host_tool"],
	})
	// …and the entry must actually be in the bundle, or the launcher points at nothing.
	.refine((d) => d.type !== "tool" || d.runtime === "host" || !d.entry || !!d.artifacts?.some((a) => a.path === d.entry), {
		message: "entry must be one of the artifacts[].path values",
		path: ["entry"],
	})
	// The executable fields are meaningless on prose. Rejecting them keeps `type` honest rather than
	// letting a knowledge bit half-declare itself a tool.
	.refine(
		(d) =>
			d.type === "tool" ||
			(d.runtime === undefined &&
				d.entry === undefined &&
				d.artifacts === undefined &&
				d.usage === undefined &&
				d.host_tool === undefined),
		{ message: "runtime/entry/usage/artifacts/host_tool are only valid on a tool bit", path: ["type"] },
	)
	// `native` ships one build per platform, so every artifact must say which platform it is for.
	.refine((d) => d.runtime !== "native" || !!d.artifacts?.every((a) => !!a.platform), {
		message: "a native tool must tag every artifact with its platform",
		path: ["artifacts"],
	})
	// A bundled pro bit is a contradiction: it already shipped inside the VSIX the user has.
	.refine((d) => d.access !== "pro" || d.delivery === "downloaded", {
		message: "access: pro requires delivery: downloaded (a bundled bit is already on disk)",
		path: ["access"],
	})
	// R1 — a tool bit must not reach a client with no tool resolver.
	.refine((d) => d.type !== "tool" || (!!d.min_ext && !semverLt(d.min_ext, TOOL_BITS_MIN_EXT)), {
		message: `a tool bit must declare min_ext >= ${TOOL_BITS_MIN_EXT} (older clients cannot resolve one)`,
		path: ["min_ext"],
	})
	// R2 — a pro bit must not reach a client that reads a 402 as "bit missing".
	.refine((d) => d.access !== "pro" || (!!d.min_ext && !semverLt(d.min_ext, PRO_AWARE_MIN_EXT)), {
		message: `a pro bit must declare min_ext >= ${PRO_AWARE_MIN_EXT} (older clients report a paywall as "registry unreachable")`,
		path: ["min_ext"],
	})
	// R3 — an entitled bit is gated the same way, so it needs the same 402-aware floor. Without this a
	// 0.3.x client would report "bit missing" for a bit that exists and is simply not theirs yet.
	.refine(
		(d) => {
			const gated = !!d.group || !!d.artifacts?.some((a) => !!a.group)
			return !gated || (!!d.min_ext && !semverLt(d.min_ext, PRO_AWARE_MIN_EXT))
		},
		{
			message: `a bit with an entitlement group must declare min_ext >= ${PRO_AWARE_MIN_EXT} (older clients report a gate as "bit missing")`,
			path: ["min_ext"],
		},
	)
	// A gated bit must be fetched, not shipped: a bundled bit is already on the developer's disk.
	.refine((d) => !d.group || d.delivery === "downloaded", {
		message: "an entitlement group requires delivery: downloaded (a bundled bit is already on disk)",
		path: ["group"],
	})

export type KBitMeta = z.infer<typeof kbitMetaSchema>
export type KBitType = (typeof KBIT_TYPES)[number]
export type KBitSafety = (typeof KBIT_SAFETY)[number]
export type KBitAccess = (typeof KBIT_ACCESS)[number]
export type KBitGroup = (typeof KBIT_GROUPS)[number]
export type KBitRuntime = (typeof KBIT_RUNTIMES)[number]
export type KBitArtifact = z.infer<typeof artifactEntry>
export type KBitStatus = (typeof KBIT_STATUS)[number]
export type CreditEntry = z.infer<typeof creditEntry>
export type Endorsement = z.infer<typeof endorsementEntry>
export type Supporter = z.infer<typeof supporterEntry>
