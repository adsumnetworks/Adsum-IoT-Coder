/**
 * The tool list must be resolved against the account that is signed in NOW and the manifest as it is
 * NOW — not against whatever was true the first time this window built a prompt.
 *
 * The key used for prompt assembly is `prompt:<cwd>`, which does not change between tasks, and the
 * snapshot map never expires. So the first resolution in a window was kept for the life of the window.
 * If that first prompt was built before the developer signed in — the ordinary first run: install, open
 * a folder, sign in — every gated tool bundle 402'd, was left out, and stayed left out until a reload.
 * On 16 Sep the BLG20x first run reached "flash the demo pair" twice with the pair nowhere advertised,
 * and the agent guessed a cache path with a version that does not exist. The account held the grant,
 * and the same materialise call made with that account's token fetched the bundle cleanly.
 */
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { toolSnapshotKey } from "./ToolResolver"

const base = { taskKey: "prompt:/home/dev/project", summary: "none" as const, cwd: "/home/dev/project" }
const pair = (version: string) => ({ id: "adsum/tools/blg20-hex-demo-pair", version, type: "tool" })

describe("tool snapshot key", () => {
	test("signing in gives a fresh resolution — a signed-out snapshot must not outlive the sign-in", () => {
		const out = toolSnapshotKey({ ...base, toolEntries: [pair("0.2.1")] })
		const inn = toolSnapshotKey({ ...base, sessionToken: "session-abc", toolEntries: [pair("0.2.1")] })
		assert.notEqual(out, inn)
	})

	test("a different account is a different set", () => {
		assert.notEqual(
			toolSnapshotKey({ ...base, sessionToken: "session-abc" }),
			toolSnapshotKey({ ...base, sessionToken: "session-xyz" }),
		)
	})

	test("a manifest listing a new tool version gives a fresh resolution", () => {
		assert.notEqual(
			toolSnapshotKey({ ...base, sessionToken: "s", toolEntries: [pair("0.2.0")] }),
			toolSnapshotKey({ ...base, sessionToken: "s", toolEntries: [pair("0.2.1")] }),
		)
	})

	test("nothing changed means the same set — the stability the snapshot exists for", () => {
		const a = toolSnapshotKey({ ...base, sessionToken: "s", toolEntries: [pair("0.2.1"), { id: "x", version: "1.0.0" }] })
		const b = toolSnapshotKey({ ...base, sessionToken: "s", toolEntries: [{ id: "x", version: "1.0.0" }, pair("0.2.1")] })
		assert.equal(a, b, "entry order is not a change")
	})

	test("the credential itself never appears in the key", () => {
		const secret = "eyJhbGciOiJIUzI1NiJ9.super-secret-session"
		assert.ok(!toolSnapshotKey({ ...base, sessionToken: secret }).includes(secret))
	})
})
