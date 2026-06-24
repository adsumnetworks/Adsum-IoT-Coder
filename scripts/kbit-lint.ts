/**
 * K-bit linter CLI — validates iot-knowledge/*.md against the K-bit contract.
 * See iot-knowledge/KBIT-SPEC.md. Run: npm run lint:kbits
 *
 * Logic lives in src/services/knowledge/kbit/lint.ts (importable + unit-tested);
 * this wrapper just does the IO + reporting + exit code.
 *
 * P0a: bits without frontmatter are WARNINGS (unmigrated), not errors.
 * Exit code is non-zero only if there is at least one ERROR.
 */
import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { lintCorpus, lintManifestFresh, lintMapping, lintVersionBump } from "../src/services/knowledge/kbit/lint"

const repoRoot = join(__dirname, "..")
const knowledgeRoot = join(repoRoot, "iot-knowledge")
const { issues, files, migrated } = lintCorpus(knowledgeRoot)

// Dev-workflow guards (see Adsum-Planning/knowledge-bits/KBIT-DEV-WORKFLOW.md):
const manifestPath = join(knowledgeRoot, "manifest.json")
const manifestJson = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "{}"
// 1. Stale/missing manifest — bit changed/added without `gen:kbit-manifest`.
issues.push(...lintManifestFresh(knowledgeRoot, files, manifestJson))
// 2. Body changed without a version bump — compare each bit's body against git HEAD.
for (const f of files) {
	let headText: string | null = null
	try {
		headText = execSync(`git show HEAD:iot-knowledge/${f}`, {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
	} catch {
		headText = null // new file or no git — nothing to compare
	}
	issues.push(...lintVersionBump(f, readFileSync(join(knowledgeRoot, f), "utf8"), headText))
}
// 3. Orphan bits not listed in any map/index (warning).
issues.push(...lintMapping(knowledgeRoot, files))

const errors = issues.filter((i) => i.level === "error")
const warns = issues.filter((i) => i.level === "warn")

for (const i of [...errors, ...warns]) {
	console.log(`  [${i.level === "error" ? "ERROR" : "warn "}] ${i.file}: ${i.msg}`)
}

const failing = new Set(errors.map((i) => i.file)).size
console.log(
	`\nK-bit lint: ${files.length} bits · ${migrated} migrated · ${errors.length} errors · ${warns.length} warnings` +
		(failing ? ` · ${failing} bit(s) failing` : ""),
)

if (errors.length > 0) {
	process.exitCode = 1
}
