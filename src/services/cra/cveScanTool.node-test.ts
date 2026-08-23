/**
 * U10 — the CVE engine as a Tool bit.
 *
 * Two things are being protected here, and only one of them is "does the scan work".
 *
 * The first is parity: the bundle that ships must produce what the source produces. The CVE lists
 * themselves cannot be compared across two runs — NVD and the EU database return different data
 * minute to minute — so what is compared is the deterministic half: the SBOM normalisation the whole
 * report's coverage numbers are built on.
 *
 * The second, and the more important, is that **a scan which did not happen can never read as clean**.
 * An absent artifact used to mean "nothing to check", so a report claiming "no known CVEs" passed
 * every integrity check by having nothing to contradict it. The door now writes a tombstone and the
 * guard treats it as a contradiction. Those cases are the bulk of this file.
 */

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { describe, test } from "node:test"
import { gatherAndCheckReadinessIntegrity } from "./reportIntegrity"
import { normalizeSbom } from "./sbomNormalize"

const ROOT = path.resolve(__dirname, "..", "..", "..")
const BUNDLE = path.resolve(ROOT, "../Adsum-Backend-tbit/kbits/cra/tools/cve-scan/cve_scan.mjs")
const SAMPLE = path.join(homedir(), ".cline-adsum-tests/data/demo/cra-prebuilt-nrf-0.3.0")
const SBOM = path.join(SAMPLE, "sbom/all.spdx")

function runTool(args: string[]): { code: number; json: Record<string, unknown> } {
	try {
		const out = execFileSync(process.execPath, [BUNDLE, ...args], {
			encoding: "utf8",
			timeout: 240_000,
			maxBuffer: 64 * 1024 * 1024,
		})
		return { code: 0, json: JSON.parse(out) }
	} catch (e) {
		const err = e as { status?: number; stdout?: string }
		return { code: err.status ?? 1, json: err.stdout ? JSON.parse(err.stdout) : {} }
	}
}

describe("U10 — the tool refuses clearly, and never as a clean scan", () => {
	test("the bundle exists (run `npm run build:tool-bundles`)", () => {
		assert.ok(existsSync(BUNDLE), BUNDLE)
	})

	test("no --sbom is bad input", () => {
		const r = runTool(["--as-of", "2026-08-24"])
		assert.equal(r.json.status, "bad-input")
	})

	test("--as-of is REQUIRED, never defaulted to today", () => {
		// The artifact filename and every attribution date derive from it. A tool that picked its own
		// date could disagree with the report it feeds, across a midnight boundary.
		const r = runTool(["--sbom", SBOM])
		assert.equal(r.json.status, "bad-input")
		assert.match(String(r.json.reason), /as-of/)
	})

	test("a malformed --as-of is refused rather than coerced", () => {
		assert.equal(runTool(["--sbom", SBOM, "--as-of", "24-08-2026"]).json.status, "bad-input")
	})

	test("a missing SBOM keeps the engine's own sentence — it tells the developer what to do next", () => {
		const r = runTool(["--sbom", "/nonexistent/all.spdx", "--as-of", "2026-08-24"])
		assert.equal(r.json.status, "bad-input")
		// Not "tool unavailable": that would send them hunting for a tooling problem they do not have.
		assert.match(String(r.json.reason), /generate an SBOM first/i)
	})
})

describe("U10 — parity with the in-process engine", { skip: existsSync(SBOM) ? false : "CRA sample bundle not on this machine" }, () => {
	test("the bundle counts the same components the host does", () => {
		// `total` is the one figure that must not move: it is what the report quotes as "N components",
		// and it is decided purely by parsing the SPDX — no database, no enrichment, no clock. The other
		// coverage fields legitimately DIFFER, because the tool applies the curated PURL and module-ref
		// maps before reporting and the bare host parse does not; comparing those would be asserting
		// that enrichment does nothing.
		const fromHost = normalizeSbom(readFileSync(SBOM, "utf8"))
		const r = runTool(["--sbom", SBOM, "--build", SAMPLE, "--as-of", "2026-08-24"])
		assert.equal(r.json.status, "ok")
		const coverage = (r.json.result as { normalized?: { coverage?: { total?: number; queryable?: number } } })?.normalized
			?.coverage
		assert.equal(coverage?.total, fromHost.coverage.total, "the component count must be identical")
		assert.ok(
			(coverage?.queryable ?? 0) >= fromHost.coverage.queryable,
			"enrichment may only ADD queryable components, never remove them",
		)
	})

	test("the enrichment Map survives the process boundary as entries, not as {}", () => {
		// JSON.stringify turns a Map into {}. Losing it would silently drop every severity and
		// fixed-version the enrichment pass found — a quality downgrade with nothing to notice.
		const r = runTool(["--sbom", SBOM, "--build", SAMPLE, "--as-of", "2026-08-24"])
		const enrichment = (r.json.result as { enrichment?: unknown })?.enrichment
		assert.ok(Array.isArray(enrichment), "enrichment must serialise as an array of entries")
	})

	test("the envelope carries everything the handler reads off a result", () => {
		const res = runTool(["--sbom", SBOM, "--build", SAMPLE, "--as-of", "2026-08-24"]).json.result as Record<string, unknown>
		for (const field of ["report", "json", "findings", "queriedCount", "coverage", "sources"]) {
			assert.ok(field in res, `the handler reads result.${field}`)
		}
	})
})

// ── the guarantee the host keeps ─────────────────────────────────────────────

describe("U10 — a scan that did not run can never read as clean", () => {
	const withArtifacts = (cveJson: string | null, report: string) => {
		const dir = mkdtempSync(path.join(tmpdir(), "cra-"))
		writeFileSync(path.join(dir, "all.spdx"), readFileSync(SBOM, "utf8"))
		if (cveJson) {
			writeFileSync(path.join(dir, "cve-scan-2026-08-24.json"), cveJson)
		}
		const reportPath = path.join(dir, "cra-readiness.md")
		writeFileSync(reportPath, report)
		return { reportPath, report }
	}

	const TOMBSTONE = JSON.stringify({
		schema: "adsum.cve-scan/1",
		status: "not-performed",
		reason: "registry-unreachable",
		asOf: "2026-08-24",
		coverage: null,
		findings: null,
	})

	// The guard only inspects something it recognises as a readiness report: the disclaimer phrase plus
	// an SBOM mention. Anything less and it correctly declines to have an opinion.
	const REPORT_HEAD =
		"# CRA Readiness — reference sample\n\nThis is not a conformity assessment.\n\nThe SBOM lists 180 components.\n\n"

	for (const claim of [
		"No known CVEs were found in this build.",
		"no known vulnerabilities affect these components",
		"3 CVEs require review.",
		"zero CVEs",
		"The build is clean.",
	]) {
		test(`"${claim}" is rejected when the scan did not run`, { skip: existsSync(SBOM) ? false : "no CRA sample" }, () => {
			const { reportPath, report } = withArtifacts(TOMBSTONE, REPORT_HEAD + claim)
			const issues = gatherAndCheckReadinessIntegrity(reportPath, report)
			assert.ok(
				issues.some((i) => i.kind === "cve-not-performed"),
				`a not-performed scan must contradict "${claim}" — got ${JSON.stringify(issues)}`,
			)
		})
	}

	test("a report that says the scan did not run is ACCEPTED — honesty is the way through", { skip: existsSync(SBOM) ? false : "no CRA sample" }, () => {
		const { reportPath, report } = withArtifacts(
			TOMBSTONE,
			`${REPORT_HEAD}The CVE scan was not performed for this build (the scan tool could not be reached), so no vulnerability statement can be made here.`,
		)
		const issues = gatherAndCheckReadinessIntegrity(reportPath, report)
		assert.ok(
			!issues.some((i) => i.kind === "cve-not-performed"),
			`stating the scan did not run must not itself be a violation — got ${JSON.stringify(issues)}`,
		)
	})

	test("the tombstone's reason travels into the message, so the developer knows WHY", { skip: existsSync(SBOM) ? false : "no CRA sample" }, () => {
		const { reportPath, report } = withArtifacts(TOMBSTONE, `${REPORT_HEAD}No known CVEs.`)
		const issue = gatherAndCheckReadinessIntegrity(reportPath, report).find((i) => i.kind === "cve-not-performed")
		assert.match(String(issue?.detail), /registry-unreachable/)
	})
})
