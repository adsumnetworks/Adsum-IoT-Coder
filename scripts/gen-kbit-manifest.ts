/**
 * Generate iot-knowledge/manifest.json — the machine-generated catalog of all K-bits,
 * derived from their frontmatter. This REPLACES hand-maintained indexes (kills the drift
 * the audit found) and is the input the P2 registry/distribution + index regeneration use.
 *
 * Run: npm run gen:kbit-manifest   (deterministic — CI can diff it to detect drift).
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { load as yamlLoad } from "js-yaml"
import { extractFrontmatter } from "../src/services/knowledge/kbit/frontmatter"
import { deriveId, listBitFiles } from "../src/services/knowledge/kbit/lint"
import { type KBitMeta, kbitMetaSchema } from "../src/services/knowledge/kbit/schema"

const ROOT = join(__dirname, "..", "iot-knowledge")
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

type ManifestEntry = KBitMeta & { path: string; content_hash: string }

const bits: ManifestEntry[] = []
const skipped: string[] = []

for (const rel of listBitFiles(ROOT)) {
	const text = readFileSync(join(ROOT, rel), "utf8")
	const fm = extractFrontmatter(text)
	if (!fm.found || !fm.closed) {
		skipped.push(rel)
		continue
	}
	const parsed = kbitMetaSchema.safeParse(yamlLoad(fm.yaml))
	if (!parsed.success) {
		skipped.push(rel)
		continue
	}
	if (parsed.data.id !== deriveId(rel)) {
		skipped.push(rel)
		continue
	}
	// content_hash is over the body (what the agent consumes), per KBIT-SPEC.
	bits.push({ ...parsed.data, path: rel, content_hash: sha256(fm.body) })
}

bits.sort((a, b) => a.id.localeCompare(b.id))

const manifest = { manifestVersion: 1, count: bits.length, bits }
const outPath = join(ROOT, "manifest.json")
writeFileSync(outPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8")
console.log(
	`Generated ${outPath} — ${bits.length} bits${skipped.length ? ` (skipped ${skipped.length} unmigrated/invalid)` : ""}`,
)
