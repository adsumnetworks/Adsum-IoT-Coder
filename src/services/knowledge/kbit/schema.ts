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

export const KBIT_TYPES = ["workflow", "action", "knowledge"] as const
export const KBIT_OWNERS = ["adsum-core", "adsum-extended", "community", "partner"] as const
export const KBIT_TIERS = ["community", "certified"] as const
export const KBIT_DELIVERY = ["bundled", "downloaded"] as const
export const KBIT_PLATFORMS = ["nrf", "esp", "universal"] as const
export const KBIT_SAFETY = ["shell", "flash", "erase", "network", "fs-write", "process-kill", "long-running"] as const

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, "version must be MAJOR.MINOR.PATCH (semver)")
const bitId = z
	.string()
	.regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/i, "id must be a namespaced slug, e.g. adsum/nrf/workflows/add-feature")
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

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
		content_hash: z.string().optional(),
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

export type KBitMeta = z.infer<typeof kbitMetaSchema>
export type KBitType = (typeof KBIT_TYPES)[number]
export type KBitSafety = (typeof KBIT_SAFETY)[number]
