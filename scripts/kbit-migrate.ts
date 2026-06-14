/**
 * One-shot migration: prepend conformant K-bit frontmatter to un-migrated bits.
 * Idempotent (skips bits that already have frontmatter). Run: npm run migrate:kbits
 * Always re-run `npm run lint:kbits` after — it validates the result (the source of truth).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { extractFrontmatter } from "../src/services/knowledge/kbit/frontmatter"
import { deriveId, detectSafety, listBitFiles } from "../src/services/knowledge/kbit/lint"

const ROOT = join(__dirname, "..", "iot-knowledge")

const bitType = (rel: string): "workflow" | "action" | "knowledge" =>
	rel.includes("/workflows/") ? "workflow" : rel.includes("/actions/") ? "action" : "knowledge"
const platformOf = (rel: string): "nrf" | "esp" | "universal" =>
	rel.startsWith("platforms/nrf/") ? "nrf" : rel.startsWith("platforms/esp/") ? "esp" : "universal"

const files = listBitFiles(ROOT)
const idByBasename = new Map(files.map((f) => [basename(f), deriveId(f)]))

let migrated = 0
for (const rel of files) {
	const full = join(ROOT, rel)
	const text = readFileSync(full, "utf8")
	if (extractFrontmatter(text).found) {
		continue // already migrated
	}
	const lines = text.split(/\r?\n/)
	const id = deriveId(rel)
	const type = bitType(rel)
	const h1 = lines.find((l) => l.startsWith("# ")) ?? `# ${basename(rel)}`
	const title = h1
		.replace(/^#\s+/, "")
		.replace(/\s*\(.*\)\s*$/, "")
		.trim()

	// triggers (workflows only): quoted phrases on the **Triggered by:** line
	let triggers: string[] = []
	if (type === "workflow") {
		const tline = lines.find((l) => /\*\*Triggered by:\*\*/.test(l)) ?? ""
		triggers = [...tline.matchAll(/`([^`]+)`|"([^"]+)"/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean)
	}

	// requires (executable bits only): .md refs on MANDATORY SKILL LOAD / read_file lines, resolved by basename
	const requires = new Set<string>()
	if (type !== "knowledge") {
		for (const l of lines) {
			if (!/MANDATORY SKILL LOAD|read_file/i.test(l)) {
				continue
			}
			for (const m of l.matchAll(/([A-Za-z0-9_./-]+\.md)/g)) {
				const tid = idByBasename.get(basename(m[1]))
				if (tid && tid !== id) {
					requires.add(tid)
				}
			}
		}
	}

	const safety = [...detectSafety(text)]

	const fm = [
		"---",
		`id: ${id}`,
		`title: ${JSON.stringify(title)}`,
		`type: ${type}`,
		"version: 1.0.0",
		"owner: adsum-core",
		"author: adsum",
		"license: CC-BY-SA-4.0",
		"tier: certified",
		"delivery: bundled",
		"domain: embedded-iot",
		`platform: ${platformOf(rel)}`,
	]
	if (type === "workflow") {
		fm.push(`triggers: [${triggers.map((t) => JSON.stringify(t)).join(", ")}]`)
	}
	if (requires.size) {
		fm.push("requires:")
		for (const r of [...requires].sort()) {
			fm.push(`  - ${r}`)
		}
	}
	if (safety.length) {
		fm.push(`safety: [${safety.join(", ")}]`)
	}
	fm.push("---", "")

	writeFileSync(full, `${fm.join("\n")}\n${text}`, "utf8")
	migrated++
	const extra = [
		type === "workflow" ? `triggers=${triggers.length}` : "",
		requires.size ? `requires=${requires.size}` : "",
		safety.length ? `safety=${safety.join("/")}` : "",
	]
		.filter(Boolean)
		.join(" ")
	console.log(`migrated ${rel}  [${type}] ${extra}`)
}
console.log(`\nmigrated ${migrated} bits`)
