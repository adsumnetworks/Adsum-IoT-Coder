/**
 * Handover — the VS Code host half (H1).
 *
 * Lives under hosts/vscode because it touches the editor directly (workspace folders, terminal, status
 * bar, output channel). The portable half — brief extraction, the managed instruction block, .mcp.json
 * merging — is `services/handover/HandoverBrief.ts`, which stays free of vscode so the standalone core
 * (and a future non-VS-Code host) can reuse it.
 *
 * Hands the current Adsum session to the developer's own coding agent (Claude Code first; the wiring is
 * standard MCP + a markdown convention, so a second agent is a config change, not a rewrite). Adsum
 * stays the knowledge and tool layer; their subscription runs the model.
 *
 * Responsibilities: build the brief from the session that just ran → pin the k-bits it actually used
 * (bodies embedded, so the foreign agent needs no network or entitlement of its own) → wire the project
 * (.mcp.json + managed CLAUDE.md) → open the agent → then TAIL the ledger so the developer can watch
 * the session they handed away, and pull it back when they want.
 */
import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { extractBriefParts, managedBlockBody, upsertManagedBlock, upsertMcpJson } from "@/services/handover/HandoverBrief"
import { deriveIdFromRel, loadBitByRel } from "@/services/knowledge/KnowledgeResolver"
import { extractFrontmatter } from "@/services/knowledge/kbit/frontmatter"

const HANDOVER_ROOT = path.join(os.homedir(), ".adsum", "handovers")
const KNOWLEDGE_DIR = "iot-knowledge"

interface BriefBit {
	id: string
	title?: string
	version?: string
	author?: string
	triggers?: string[]
	body: string
}

/** One line of frontmatter (the bundled manifest is richer, but a bit's own head is always truthful). */
function fmField(yaml: string, key: string): string | undefined {
	return yaml.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim()
}

export class VscodeHandoverService {
	private tracker?: NodeJS.Timeout
	private offset = 0
	private activeId?: string
	private status?: vscode.StatusBarItem
	private out?: vscode.OutputChannel

	constructor(private readonly context: vscode.ExtensionContext) {}

	// ── brief ────────────────────────────────────────────────────────────────
	/** The newest recorded session for this install (same store the agent writes as it works). */
	private newestTaskDir(): string | undefined {
		const tasks = path.join(this.context.globalStorageUri.fsPath, "tasks")
		try {
			const dirs = fs
				.readdirSync(tasks, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => ({ p: path.join(tasks, e.name), m: fs.statSync(path.join(tasks, e.name)).mtimeMs }))
				.sort((a, b) => b.m - a.m)
			return dirs[0]?.p
		} catch {
			return undefined
		}
	}

	/** Load the bits the session used, with metadata, so the brief is self-contained. */
	private async collectBits(relPaths: string[]): Promise<BriefBit[]> {
		const bundledDir = path.join(this.context.extensionPath, KNOWLEDGE_DIR)
		const out: BriefBit[] = []
		for (const rel of relPaths.slice(0, 15)) {
			const id = deriveIdFromRel(rel)
			// Body via the resolver's own path (bundled → cache → registry, entitlement-aware).
			let body = ""
			try {
				body = (await loadBitByRel(rel)) ?? ""
			} catch {}
			// Metadata from the bit's frontmatter — loadBit* strips it, so read the bundled file head when present.
			let title: string | undefined
			let version: string | undefined
			let author: string | undefined
			let triggers: string[] | undefined
			try {
				const raw = fs.readFileSync(path.join(bundledDir, rel), "utf8")
				const fm = extractFrontmatter(raw)
				if (fm.found && fm.closed) {
					title = fmField(fm.yaml, "title")
					version = fmField(fm.yaml, "version")
					author = fmField(fm.yaml, "author")
					const t = fm.yaml.match(/^triggers:\s*\[([^\]]*)\]/m)?.[1]
					if (t) {
						triggers = t.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
					}
				}
				if (!body) {
					body = fm.body
				}
			} catch {
				// downloaded-only bit: no local file. Body came from the resolver; metadata falls back below.
			}
			if (!body) {
				continue // nothing to serve — skip rather than hand over an empty skill
			}
			out.push({ id, title: title ?? id.split("/").pop(), version, author: author ?? "Adsum", triggers, body })
		}
		return out
	}

	private environmentLine(): string {
		const bits: string[] = []
		try {
			const boards = execSync("nrfutil device list 2>/dev/null || true", { timeout: 4000 }).toString()
			const ids = [...boards.matchAll(/^\s*(\d{9,})/gm)].map((m) => m[1])
			if (ids.length) {
				bits.push(`boards: ${ids.join(", ")}`)
			}
		} catch {}
		bits.push(`os: ${os.platform()} ${os.arch()}`)
		return bits.join(" · ")
	}

	/**
	 * Where is the agent's CLI? Most developers run Claude Code from the VS Code extension and never put
	 * `claude` on their shell PATH — a bare `claude` then dies with "command not found" in the terminal,
	 * which looks exactly like the handover doing nothing. So prefer the extension's own bundled binary
	 * (absolute path, always launchable) and fall back to the PATH name only if the extension is absent.
	 */
	private resolveAgentCli(): { cmd: string; bundled: boolean } {
		try {
			const ext = vscode.extensions.getExtension("anthropic.claude-code")
			if (ext) {
				const p = path.join(ext.extensionPath, "resources", "native-binary", "claude")
				if (fs.existsSync(p)) {
					return { cmd: p, bundled: true }
				}
			}
		} catch {}
		// Extension not installed (or a layout we don't know): try the newest side-by-side install, then PATH.
		try {
			const root = path.join(os.homedir(), ".vscode", "extensions")
			const dirs = fs
				.readdirSync(root)
				.filter((d) => d.startsWith("anthropic.claude-code-"))
				.sort()
				.reverse()
			for (const d of dirs) {
				const p = path.join(root, d, "resources", "native-binary", "claude")
				if (fs.existsSync(p)) {
					return { cmd: p, bundled: true }
				}
			}
		} catch {}
		return { cmd: "claude", bundled: false }
	}

	// ── the command: hand over ───────────────────────────────────────────────
	async handOver(): Promise<void> {
		const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!ws) {
			vscode.window.showWarningMessage("Adsum: open a project folder before handing a session over.")
			return
		}
		const taskDir = this.newestTaskDir()
		let parts = { mission: "", worklog: [] as string[], nextStep: "", lastSummary: "", kbitRelPaths: [] as string[] }
		if (taskDir) {
			try {
				const ui = JSON.parse(fs.readFileSync(path.join(taskDir, "ui_messages.json"), "utf8"))
				const meta = JSON.parse(fs.readFileSync(path.join(taskDir, "task_metadata.json"), "utf8"))
				parts = extractBriefParts(ui, meta)
			} catch {}
		}
		// A handover with no prior session is legitimate (hand over a fresh card) — the brief is just thinner.
		const bits = await this.collectBits(parts.kbitRelPaths)
		const id = Math.random().toString(36).slice(2, 6)
		const dir = path.join(HANDOVER_ROOT, id)
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(
			path.join(dir, "brief.json"),
			JSON.stringify(
				{
					createdAt: new Date().toISOString(),
					workspace: ws,
					env: this.environmentLine(),
					mission: parts.mission || "(started fresh in the coding agent)",
					worklog: parts.worklog,
					nextStep: parts.nextStep || parts.lastSummary,
					lastSummary: parts.lastSummary,
					bits,
					extVersion: this.context.extension.packageJSON.version,
				},
				null,
				1,
			),
		)
		fs.writeFileSync(
			path.join(dir, "state.json"),
			JSON.stringify({ status: "pending", createdAt: new Date().toISOString() }, null, 1),
		)

		// Wire the project: standard MCP config + the managed instruction block.
		const serverPath = path.join(this.context.extensionPath, "mcp", "adsum-mcp.mjs")
		upsertMcpJson(path.join(ws, ".mcp.json"), serverPath)
		const blockResult = upsertManagedBlock(path.join(ws, "CLAUDE.md"), managedBlockBody(id))

		this.startTracking(id)
		// Launch the agent WITH its opening turn. A bare `claude` opens an interactive prompt and waits —
		// and CLAUDE.md only takes effect once the agent actually processes a turn, so a bare launch sits
		// idle forever and the handover looks like it did nothing. Giving it the first instruction is what
		// makes the handover self-starting.
		const kickoff = `Resume Adsum handover ${id}: call the adsum MCP tool resume_handover first, then continue the mission it returns.`
		const cli = this.resolveAgentCli()
		const term = vscode.window.createTerminal({ name: "Claude Code — Adsum handover", cwd: ws })
		term.sendText(`${JSON.stringify(cli.cmd)} ${JSON.stringify(kickoff)}`)
		term.show()
		const note = blockResult === "skipped-user-edited" ? " (CLAUDE.md block left as you edited it)" : ""
		const pick = await vscode.window.showInformationMessage(
			cli.bundled
				? `Session handed over (${id})${note}. Approve the "adsum" MCP server in the terminal when Claude Code asks — then it resumes on its own.`
				: `Session handed over (${id})${note}. Couldn't find the Claude Code binary, so the terminal runs "claude" from your PATH — if it reports "command not found", install Claude Code and re-run.`,
			"Show terminal",
			"Watch progress",
		)
		if (pick === "Watch progress") {
			this.out?.show(true)
		} else if (pick === "Show terminal") {
			term.show()
		}
	}

	// ── tracking: the ledger is the only honest record ───────────────────────
	private startTracking(id: string): void {
		this.stopTracking()
		this.activeId = id
		this.offset = 0
		this.out ??= vscode.window.createOutputChannel("Adsum Handover")
		this.status ??= vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
		this.out.show(true)
		this.out.appendLine(`— handover ${id} — watching what your agent does with it —`)
		this.out.appendLine(`  (nothing appears here until the agent calls an adsum tool — approve the MCP server if prompted)`)
		let calls = 0
		let lastEventAt = Date.now()
		// Show the indicator immediately: "we are watching, the agent hasn't called yet" is real state and
		// far more useful than an empty status bar that looks like the command did nothing.
		this.status.text = `$(broadcast) Adsum ⇄ agent · waiting`
		this.status.tooltip = "Handed-over session: waiting for your coding agent to call an Adsum tool. Click to watch."
		this.status.command = "adsum-iot-coder.watchHandover"
		this.status.show()
		this.tracker = setInterval(() => {
			const f = path.join(HANDOVER_ROOT, id, "ledger.jsonl")
			let text = ""
			try {
				const stat = fs.statSync(f)
				if (stat.size <= this.offset) {
					// no new events: after 10 quiet minutes stop claiming "live"
					if (Date.now() - lastEventAt > 600_000 && this.status) {
						this.status.text = `$(circle-outline) Adsum ⇄ agent · idle`
					}
					return
				}
				const fd = fs.openSync(f, "r")
				const buf = Buffer.alloc(stat.size - this.offset)
				fs.readSync(fd, buf, 0, buf.length, this.offset)
				fs.closeSync(fd)
				this.offset = stat.size
				text = buf.toString("utf8")
			} catch {
				return
			}
			for (const line of text.split("\n").filter(Boolean)) {
				let e: any
				try {
					e = JSON.parse(line)
				} catch {
					continue
				}
				calls++
				lastEventAt = Date.now()
				if (e.event === "resume") {
					this.out?.appendLine(`▶ agent resumed the session (${e.bits} knowledge bits offered)`)
				} else if (e.event === "kbit_load") {
					this.out?.appendLine(`⚒ loaded ${e.id}   📚 ${e.title ?? ""} — curated by ${e.author ?? "Adsum"}`)
				} else if (e.event === "checkpoint") {
					this.out?.appendLine(`✓ checkpoint: ${e.worklog}`)
					vscode.window.setStatusBarMessage(`Adsum ⇄ agent: ${e.worklog}`, 6000)
				}
			}
			if (this.status) {
				this.status.text = `$(broadcast) Adsum ⇄ agent · ${calls} call${calls === 1 ? "" : "s"}`
				this.status.tooltip = "Your coding agent is working on a handed-over Adsum session. Click to watch."
				this.status.command = "adsum-iot-coder.watchHandover"
				this.status.show()
			}
		}, 3000)
	}

	private stopTracking(): void {
		if (this.tracker) {
			clearInterval(this.tracker)
		}
		this.tracker = undefined
	}

	watch(): void {
		this.out?.show(true)
	}

	// ── the command: bring it back ───────────────────────────────────────────
	/** Compose the resume prompt. Returns undefined when there is nothing to come back to. */
	buildResumePrompt(id?: string): { id: string; prompt: string } | undefined {
		const hid = id ?? this.activeId ?? this.newestHandoverId()
		if (!hid) {
			return undefined
		}
		const dir = path.join(HANDOVER_ROOT, hid)
		let brief: any = {}
		try {
			brief = JSON.parse(fs.readFileSync(path.join(dir, "brief.json"), "utf8"))
		} catch {}
		const events: any[] = []
		try {
			for (const l of fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").split("\n").filter(Boolean)) {
				try {
					events.push(JSON.parse(l))
				} catch {}
			}
		} catch {}
		const checkpoints = events.filter((e) => e.event === "checkpoint").map((e) => e.worklog)
		const loaded = [...new Set(events.filter((e) => e.event === "kbit_load").map((e) => e.id))]
		const prompt = [
			`Continue this task — it was handed to my coding agent and I'm bringing it back.`,
			"",
			`Original mission: ${brief.mission ?? "(unknown)"}`,
			brief.worklog?.length ? `Done before handover:\n${brief.worklog.map((w: string) => `- ${w}`).join("\n")}` : "",
			checkpoints.length
				? `Done in the external agent:\n${checkpoints.map((c) => `- ${c}`).join("\n")}`
				: "- (the external agent recorded no checkpoints)",
			loaded.length ? `Knowledge it used: ${loaded.join(", ")}` : "",
			"",
			"Pick up from there.",
		]
			.filter(Boolean)
			.join("\n")
		return { id: hid, prompt }
	}

	private newestHandoverId(): string | undefined {
		try {
			return fs
				.readdirSync(HANDOVER_ROOT, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => ({ id: e.name, m: fs.statSync(path.join(HANDOVER_ROOT, e.name)).mtimeMs }))
				.sort((a, b) => b.m - a.m)[0]?.id
		} catch {
			return undefined
		}
	}

	markReturned(id: string): void {
		const p = path.join(HANDOVER_ROOT, id, "state.json")
		try {
			const cur = JSON.parse(fs.readFileSync(p, "utf8"))
			fs.writeFileSync(p, JSON.stringify({ ...cur, status: "returned", returnedAt: new Date().toISOString() }, null, 1))
			fs.appendFileSync(
				path.join(HANDOVER_ROOT, id, "ledger.jsonl"),
				JSON.stringify({ t: new Date().toISOString(), event: "returned" }) + "\n",
			)
		} catch {}
		this.stopTracking()
		this.status?.hide()
	}

	dispose(): void {
		this.stopTracking()
		this.status?.dispose()
		this.out?.dispose()
	}
}
