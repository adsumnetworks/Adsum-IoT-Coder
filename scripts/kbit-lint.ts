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
import { join } from "node:path"
import { lintCorpus } from "../src/services/knowledge/kbit/lint"

const knowledgeRoot = join(__dirname, "..", "iot-knowledge")
const { issues, files, migrated } = lintCorpus(knowledgeRoot)

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
