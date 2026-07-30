/** Export one session as a single portable file you can hand to someone else.
 *
 *  A session transcript is a genuinely useful thing to share — attach it to a bug report, send it to a
 *  colleague who knows the board better, hand it to whoever maintains the workflow you were following.
 *  What makes that unsafe is what a transcript CONTAINS: the model sees your environment, and provider
 *  keys, tokens and connection strings end up quoted back into the conversation.
 *
 *  So redaction happens HERE, when the file is written — not wherever it eventually lands. A file that
 *  leaves this machine has already been through the scrubber, and the export tells you how many values it
 *  removed so you can judge for yourself before sending it.
 *
 *  Pure: no vscode import, so it is unit-testable and safe for the standalone build.
 */
import * as fs from "fs"
import * as path from "path"
import * as zlib from "zlib"

/** Envelope format version. Readers refuse anything newer than they understand. */
const FORMAT = 1
export const SESSION_EXPORT_EXT = ".adsum-session.json.gz"

/** The files that constitute a session on disk. Nothing else in a task directory is exported. */
const SESSION_FILES = ["ui_messages.json", "api_conversation_history.json", "task_metadata.json"]
const FOCUS_CHAIN = /^focus_chain_taskid_[\w-]+\.md$/

/**
 * Secret shapes worth removing before a transcript travels.
 *
 * Deliberately conservative: each rule targets a recognisable credential format rather than guessing at
 * "anything that looks random", because a scrubber that mangles source code teaches people to turn it off.
 * Ordering matters — the specific provider formats run before the generic assignment catch-all.
 */
const RULES: { name: string; re: RegExp; sub: string }[] = [
	{ name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, sub: "[REDACTED-anthropic-key]" },
	{ name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}/g, sub: "[REDACTED-openai-key]" },
	{ name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, sub: "[REDACTED-github-token]" },
	{ name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, sub: "[REDACTED-slack-token]" },
	{ name: "aws-key", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, sub: "[REDACTED-aws-key]" },
	{ name: "posthog-key", re: /\bphx_[A-Za-z0-9]{20,}/g, sub: "[REDACTED-posthog-key]" },
	{ name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, sub: "[REDACTED-jwt]" },
	{
		name: "private-key",
		re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		sub: "[REDACTED-private-key]",
	},
	// The replacement contains no colon, so a second pass cannot mistake it for credentials — the scrubber
	// stays idempotent, which matters because the receiving side may scrub again.
	{
		name: "url-creds",
		re: /\b([a-z][a-z0-9+.-]*:\/\/)(?!\[REDACTED)([^\s/:@"']+):([^\s/@"']+)@/gi,
		sub: "$1[REDACTED-url-creds]@",
	},
	{ name: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{16,}/g, sub: "Bearer [REDACTED-bearer]" },
	{
		name: "assigned-secret",
		re: /\b((?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*)(["']?)([A-Za-z0-9/+_-]{12,})\2/gi,
		sub: "$1$2[REDACTED-secret]$2",
	},
]

export function scrubText(text: string): { text: string; counts: Record<string, number> } {
	let out = text
	const counts: Record<string, number> = {}
	for (const r of RULES) {
		out = out.replace(r.re, (...args) => {
			counts[r.name] = (counts[r.name] ?? 0) + 1
			// keep captured groups working for the substitution patterns that use them
			return r.sub.replace(/\$(\d)/g, (_, d) => String(args[Number(d)] ?? ""))
		})
	}
	return { text: out, counts }
}

export interface SessionExportResult {
	file: string
	taskId: string
	files: string[]
	redactions: number
	byKind: Record<string, number>
}

const isSessionFile = (n: string) => SESSION_FILES.includes(n) || FOCUS_CHAIN.test(n)

/**
 * Write `<taskId>.adsum-session.json.gz` — a flat, already-scrubbed envelope.
 *
 * Flat on purpose: there are no paths inside, so an importer has no traversal to defend against, and
 * `gzip -dc file | less` is enough to read exactly what you are about to send.
 */
export function exportSessionFolder(opts: {
	taskDir: string
	outPath: string
	taskId?: string
	extensionVersion?: string | null
}): SessionExportResult {
	if (!fs.existsSync(path.join(opts.taskDir, "ui_messages.json"))) {
		throw new Error(`that folder does not look like a session (no ui_messages.json): ${opts.taskDir}`)
	}
	const entries = fs.readdirSync(opts.taskDir).filter(isSessionFile)
	const files: Record<string, string> = {}
	const byKind: Record<string, number> = {}
	for (const name of entries) {
		const r = scrubText(fs.readFileSync(path.join(opts.taskDir, name), "utf8"))
		for (const [k, v] of Object.entries(r.counts)) byKind[k] = (byKind[k] ?? 0) + v
		files[name] = r.text
	}

	const taskId =
		opts.taskId ??
		entries.find((f) => FOCUS_CHAIN.test(f))?.match(/^focus_chain_taskid_([\w-]+)\.md$/)?.[1] ??
		path.basename(opts.taskDir)

	// The origin OS belongs to the RUN, not to whoever opens the file later.
	let originOs = `${process.platform}/${process.arch}`
	try {
		const env = JSON.parse(files["task_metadata.json"] ?? "{}").environment_history?.[0]
		if (env?.os_name) originOs = `${env.os_name}/${env.os_arch ?? "?"}`
	} catch {}

	const manifest = {
		format: FORMAT,
		taskId,
		exportedAt: new Date().toISOString(),
		originOs,
		extensionVersion: opts.extensionVersion ?? null,
		expert: null,
		scrubbed: byKind,
		files: Object.keys(files),
		note: "Adsum session export. Secrets were redacted before this file was written; review before sharing widely.",
	}

	// File-vs-directory is decided by the NAME, not by whether the path exists yet: an output directory that
	// has not been created would otherwise be treated as a filename, writing a bundle with no extension —
	// which readers reject, since they pick their format by extension.
	const file =
		opts.outPath.endsWith(SESSION_EXPORT_EXT) || opts.outPath.endsWith(".gz")
			? opts.outPath
			: path.join(opts.outPath, `${taskId}${SESSION_EXPORT_EXT}`)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify({ manifest, files }), "utf8")))

	return {
		file,
		taskId,
		files: Object.keys(files),
		redactions: Object.values(byKind).reduce((a, b) => a + b, 0),
		byKind,
	}
}
