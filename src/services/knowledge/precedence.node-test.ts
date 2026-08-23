import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { choose, fallback, type PrecedenceReason, reasonText } from "./precedence"

/**
 * U13 — the precedence rule, exhaustively.
 *
 * The reason this suite is table-driven over EVERY `PrecedenceReason` is that the dangerous failure
 * here is not "the wrong copy won" — it is "no copy won". Before this rule existed, a hash mismatch
 * returned the empty string, and every caller treats "" as "bit not found" rather than "fall back".
 * So the first assertion of each row is the same: a bundled copy exists, therefore a bundled copy is
 * what comes out.
 */

const BUNDLED = { version: "1.0.0", title: "bundled copy" }
const CTX = { extVersion: "0.3.0", enforcement: "not-enforced" as const }

const TOOL_ROW = {
	version: "1.1.0",
	runtime: "python3",
	entry: "x.py",
	usage: "x --help",
	artifacts: [{ path: "x.py", sha256: "a" }],
	readonly: true,
	safety: [],
}

describe("precedence — registry-newer-wins", () => {
	test("a newer, supported registry row wins", () => {
		const c = choose("id", BUNDLED, { version: "1.1.0" }, CTX)
		assert.equal(c.copy, "registry")
	})

	test("a registry-only id (nothing bundled) still resolves to the registry", () => {
		const c = choose("id", null, { version: "1.0.0" }, CTX)
		assert.equal(c.copy, "registry")
	})

	test("a dev local override outranks everything, including a newer registry row", () => {
		const c = choose("id", BUNDLED, { version: "9.9.9" }, { ...CTX, localPath: "/tmp/x.md" })
		assert.equal(c.copy, "local")
	})
})

describe("precedence — every reason falls back to the bundled copy, never to nothing", () => {
	const rows: { reason: PrecedenceReason; run: () => ReturnType<typeof choose> }[] = [
		{ reason: "no-registry-row", run: () => choose("id", BUNDLED, null, CTX) },
		{
			reason: "exempt",
			run: () => choose("id", BUNDLED, { version: "9.9.9" }, { ...CTX, exempt: new Set(["id"]) }),
		},
		{ reason: "bad-version", run: () => choose("id", BUNDLED, { version: "1.1.0-rc1" }, CTX) },
		{ reason: "not-newer", run: () => choose("id", BUNDLED, { version: "1.0.0" }, CTX) },
		{
			reason: "min_ext-unmet",
			run: () => choose("id", BUNDLED, { version: "1.1.0", min_ext: "0.4.0" }, CTX),
		},
		{
			reason: "status",
			run: () => choose("id", BUNDLED, { version: "1.1.0", status: "revoked" }, CTX),
		},
		{
			reason: "incomplete-descriptor",
			run: () => choose("id", BUNDLED, { version: "1.1.0" }, { ...CTX, kind: "tool" }),
		},
		{
			reason: "no-launcher",
			run: () =>
				choose("id", BUNDLED, TOOL_ROW, { ...CTX, kind: "tool", hasPlatformLauncher: () => false }),
		},
		{
			reason: "unsigned",
			run: () =>
				choose("id", BUNDLED, TOOL_ROW, {
					...CTX,
					kind: "tool",
					enforcement: "ok",
					signatureOk: () => false,
				}),
		},
		// The reasons the caller reports back after its I/O failed.
		{ reason: "unverified", run: () => fallback(BUNDLED, "unverified") },
		{ reason: "fetch-failed", run: () => fallback(BUNDLED, "fetch-failed") },
		{ reason: "hash-failed", run: () => fallback(BUNDLED, "hash-failed") },
		{ reason: "parse-failed", run: () => fallback(BUNDLED, "parse-failed") },
		{ reason: "offline-uncached", run: () => fallback(BUNDLED, "offline-uncached") },
		{ reason: "unreadable", run: () => fallback(BUNDLED, "unreadable") },
	]

	for (const { reason, run } of rows) {
		test(`${reason} → the bundled copy, with that reason`, () => {
			const c = run()
			assert.equal(c.copy, "bundled", `${reason} must not resolve to the registry`)
			if (c.copy === "bundled") {
				assert.equal(c.reason, reason)
				assert.ok(c.entry, "the bundled entry must come back — never null when one exists")
				assert.ok(reasonText(reason).length > 0, "every reason must have a log line")
			}
		})
	}

	test("the table covers every reason the type allows", () => {
		// If a reason is added without a row here, this fails — the point of the suite is exhaustiveness.
		const covered = new Set(rows.map((r) => r.reason))
		const all: PrecedenceReason[] = [
			"no-registry-row",
			"exempt",
			"bad-version",
			"not-newer",
			"min_ext-unmet",
			"status",
			"incomplete-descriptor",
			"no-launcher",
			"unsigned",
			"unverified",
			"fetch-failed",
			"hash-failed",
			"parse-failed",
			"offline-uncached",
			"unreadable",
		]
		assert.deepEqual([...all].filter((r) => !covered.has(r)), [])
	})
})

describe("precedence — version comparison refuses to guess", () => {
	for (const bad of ["1.0.0-rc1", "1.2", "v1.2.3", "", "latest"]) {
		test(`registry version ${JSON.stringify(bad)} is never newer`, () => {
			const c = choose("id", BUNDLED, { version: bad }, CTX)
			assert.equal(c.copy, "bundled")
		})
	}

	test("a non-string version is treated as absent, and nothing throws", () => {
		for (const junk of [12, null, ["1.0.0"], { v: 1 }]) {
			const c = choose("id", BUNDLED, { version: junk } as Record<string, unknown>, CTX)
			assert.equal(c.copy, "bundled")
			if (c.copy === "bundled") {
				assert.equal(c.reason, "bad-version")
			}
		}
	})

	test("a junk bundled version also refuses the override", () => {
		const c = choose("id", { version: "1.0" }, { version: "2.0.0" }, CTX)
		assert.equal(c.copy, "bundled")
	})
})

describe("precedence — min_ext is re-checked client-side on every row", () => {
	test("a floor this extension meets is fine", () => {
		assert.equal(choose("id", BUNDLED, { version: "1.1.0", min_ext: "0.3.0" }, CTX).copy, "registry")
	})
	test("an absent floor means universal", () => {
		assert.equal(choose("id", BUNDLED, { version: "1.1.0" }, CTX).copy, "registry")
	})
	test("a cached catalog fetched by a newer extension cannot override this one", () => {
		// The exact scenario: 0.3.2 fetched the catalog, the profile was rolled back to 0.3.0, and the
		// catalog on disk still carries rows only 0.3.2 can run.
		const c = choose("id", BUNDLED, { version: "9.9.9", min_ext: "0.3.2" }, { ...CTX, extVersion: "0.3.0" })
		assert.equal(c.copy, "bundled")
		if (c.copy === "bundled") {
			assert.equal(c.reason, "min_ext-unmet")
		}
	})
	test("a nightly build version compares as an ordinary patch number", () => {
		const c = choose(
			"id",
			BUNDLED,
			{ version: "1.1.0", min_ext: "0.3.0" },
			{ ...CTX, extVersion: "0.3.1761234567" },
		)
		assert.equal(c.copy, "registry")
	})
	test("an unusable extension version refuses every override", () => {
		for (const v of ["", "unknown", "0.3"]) {
			assert.equal(choose("id", BUNDLED, { version: "9.9.9" }, { ...CTX, extVersion: v }).copy, "bundled")
		}
	})
})

describe("precedence — status", () => {
	for (const status of [undefined, "published", "draft"]) {
		test(`status ${String(status)} is eligible`, () => {
			assert.equal(choose("id", BUNDLED, { version: "1.1.0", status }, CTX).copy, "registry")
		})
	}
	for (const status of ["deprecated", "revoked"]) {
		test(`status ${status} is not, even though it is newer`, () => {
			assert.equal(choose("id", BUNDLED, { version: "9.9.9", status }, CTX).copy, "bundled")
		})
	}
})

describe("precedence — tool rows carry extra requirements", () => {
	const toolCtx = { ...CTX, kind: "tool" as const, hasPlatformLauncher: () => true }

	test("a complete descriptor overrides", () => {
		assert.equal(choose("id", BUNDLED, TOOL_ROW, toolCtx).copy, "registry")
	})

	for (const missing of ["runtime", "entry", "usage", "artifacts", "readonly", "safety"]) {
		test(`a row missing ${missing} keeps the bundled tool`, () => {
			const row: Record<string, unknown> = { ...TOOL_ROW }
			delete row[missing]
			const c = choose("id", BUNDLED, row, toolCtx)
			assert.equal(c.copy, "bundled")
			if (c.copy === "bundled") {
				assert.equal(c.reason, "incomplete-descriptor")
			}
		})
	}

	test("an empty artifacts list is not a descriptor", () => {
		assert.equal(choose("id", BUNDLED, { ...TOOL_ROW, artifacts: [] }, toolCtx).copy, "bundled")
	})

	test("readonly:false and a non-empty safety list are still complete — present, not truthy", () => {
		const row = { ...TOOL_ROW, readonly: false, safety: ["flash"] }
		assert.equal(choose("id", BUNDLED, row, toolCtx).copy, "registry")
	})
})

describe("precedence — signing is a feature that is currently off", () => {
	test("with enforcement off, an unsigned override is accepted", () => {
		const c = choose("id", BUNDLED, TOOL_ROW, {
			...CTX,
			kind: "tool",
			hasPlatformLauncher: () => true,
			signatureOk: () => false,
		})
		assert.equal(c.copy, "registry")
	})
	test("with enforcement on, it is refused", () => {
		const c = choose("id", BUNDLED, TOOL_ROW, {
			...CTX,
			kind: "tool",
			enforcement: "ok",
			hasPlatformLauncher: () => true,
			signatureOk: () => false,
		})
		assert.equal(c.copy, "bundled")
	})
	test("with enforcement on and a valid signature, it is accepted", () => {
		const c = choose("id", BUNDLED, TOOL_ROW, {
			...CTX,
			kind: "tool",
			enforcement: "ok",
			hasPlatformLauncher: () => true,
			signatureOk: () => true,
		})
		assert.equal(c.copy, "registry")
	})
})
