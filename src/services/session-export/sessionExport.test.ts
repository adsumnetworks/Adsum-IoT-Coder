import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import * as zlib from "node:zlib"
import { exportSessionFolder, SESSION_EXPORT_EXT, scrubText } from "./SessionExport"

/**
 * Exporting a session moves a transcript off this machine. A transcript is exactly the place a provider key
 * ends up — the model reads your environment and quotes it back. So the test that matters is not "did we
 * count some redactions" but "can anyone find the secret in the file we are about to hand over".
 */

const SECRETS = {
	anthropic: "sk-ant-api03-NOTAREALKEY1234567890",
	github: "ghp_ABCDEFGHIJKLMNOPQRSTUV1234",
	aws: "AKIAIOSFODNN7EXAMPLE",
	bearer: "abcdefghij1234567890XYZ",
	pw: "hunter22",
	jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
}

function sessionDir(taskId = "1799000000001"): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-sess-"))
	const t = path.join(dir, taskId)
	fs.mkdirSync(t)
	fs.writeFileSync(path.join(t, `focus_chain_taskid_${taskId}.md`), "- [x] flash")
	fs.writeFileSync(
		path.join(t, "ui_messages.json"),
		JSON.stringify([{ say: "text", text: `flash it; export ANTHROPIC_API_KEY=${SECRETS.anthropic}` }]),
	)
	fs.writeFileSync(
		path.join(t, "task_metadata.json"),
		JSON.stringify({ environment_history: [{ os_name: "win32", os_arch: "x64" }] }),
	)
	fs.writeFileSync(
		path.join(t, "api_conversation_history.json"),
		JSON.stringify([
			{
				role: "assistant",
				content: `${SECRETS.github} / ${SECRETS.aws} / Bearer ${SECRETS.bearer} / ${SECRETS.jwt} / postgres://admin:${SECRETS.pw}@db:5432/x`,
			},
		]),
	)
	fs.writeFileSync(path.join(t, "notes.txt"), "not part of a session")
	return t
}

describe("session export", () => {
	test("no secret survives into the exported file", () => {
		const src = sessionDir()
		const out = fs.mkdtempSync(path.join(os.tmpdir(), "out-"))
		const r = exportSessionFolder({ taskDir: src, outPath: out, extensionVersion: "0.1.8" })

		const plain = zlib.gunzipSync(fs.readFileSync(r.file)).toString("utf8")
		for (const [name, secret] of Object.entries(SECRETS)) {
			assert.ok(!plain.includes(secret), `${name} survived into the exported session`)
		}
		assert.ok(r.redactions >= 6, `expected every planted secret to be counted, got ${r.redactions}`)
		assert.ok(r.file.endsWith(SESSION_EXPORT_EXT))
	})

	test("only session files travel, and the id comes from the focus-chain marker", () => {
		const src = sessionDir()
		const out = fs.mkdtempSync(path.join(os.tmpdir(), "out-"))
		const r = exportSessionFolder({ taskDir: src, outPath: out })
		assert.equal(r.taskId, "1799000000001")
		assert.ok(!r.files.includes("notes.txt"), "unrelated files must not be exported")
		assert.deepEqual(r.files.slice().sort(), [
			"api_conversation_history.json",
			"focus_chain_taskid_1799000000001.md",
			"task_metadata.json",
			"ui_messages.json",
		])
	})

	test("the envelope carries the provenance the receiving side must not have to guess", () => {
		const src = sessionDir()
		const out = fs.mkdtempSync(path.join(os.tmpdir(), "out-"))
		const r = exportSessionFolder({ taskDir: src, outPath: out, extensionVersion: "0.1.8" })
		const { manifest, files } = JSON.parse(zlib.gunzipSync(fs.readFileSync(r.file)).toString("utf8"))

		assert.equal(manifest.format, 1, "format version is what lets a reader refuse a newer file safely")
		assert.equal(manifest.originOs, "win32/x64", "the OS belongs to the RUN, not to whoever reads it later")
		assert.equal(manifest.extensionVersion, "0.1.8")
		assert.ok(manifest.exportedAt)
		assert.ok(Object.keys(manifest.scrubbed).length, "redaction counts are recorded, not just applied")
		// Flat by construction: no paths inside means an importer has no traversal to defend against.
		for (const name of Object.keys(files)) {
			assert.equal(name, path.basename(name), `entry '${name}' must not contain a path`)
		}
	})

	test("scrubbing is idempotent, so scrubbing again on arrival finds nothing new", () => {
		// The receiving end scrubs too (belt and braces). A rule matching its own replacement would inflate
		// the counts and make "0 redactions" impossible to interpret.
		const once = scrubText(`k=${SECRETS.anthropic} db=postgres://admin:${SECRETS.pw}@h/x auth=Bearer ${SECRETS.bearer}`)
		const twice = scrubText(once.text)
		assert.equal(twice.text, once.text)
		assert.deepEqual(twice.counts, {})
	})

	test("normal code is left alone — a scrubber people turn off protects nobody", () => {
		const code = `const version = "1.2.3"\nPATH=/usr/local/bin\nconst url = "https://api.example.com/v1/items"`
		const r = scrubText(code)
		assert.equal(r.text, code)
		assert.deepEqual(r.counts, {})
	})

	test("a folder that is not a session is refused by name, not by stack trace", () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"))
		assert.throws(() => exportSessionFolder({ taskDir: empty, outPath: empty }), /does not look like a session/)
	})
})
