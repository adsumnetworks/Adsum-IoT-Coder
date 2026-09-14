/**
 * The ONE definition of which test files belong to node's own runner rather than to mocha.
 *
 * Shared by .mocharc.cjs (which ignores them) and scripts/run-node-tests.mjs (which runs them), so a file is
 * always run by exactly one of the two. A file belongs to node's runner if it is named `*.node-test.ts`, or
 * is a `*.test.ts` that imports `node:test` — its runner is what it imports, not what it is called.
 */
const { readdirSync, readFileSync, statSync } = require("node:fs")
const path = require("node:path")

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name.startsWith(".")) continue
		const full = path.join(dir, name)
		if (statSync(full).isDirectory()) walk(full, out)
		else out.push(full)
	}
	return out
}

function findNodeRunnerTests(root = path.resolve(__dirname, "..")) {
	return walk(path.join(root, "src"))
		.map((f) => path.relative(root, f).split(path.sep).join("/"))
		.filter((rel) => {
			if (rel.endsWith(".node-test.ts")) return true
			if (!rel.endsWith(".test.ts")) return false
			return /from\s+["']node:test["']/.test(readFileSync(path.join(root, rel), "utf8"))
		})
		.sort()
}

module.exports = { findNodeRunnerTests }
