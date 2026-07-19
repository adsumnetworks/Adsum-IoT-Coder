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
import { getFreeTierTokensForDisplay } from "@/services/adsum/FreeTierState"
import {
	bridgeLoadVerbs,
	coreFallbackId,
	extractBitRefs,
	extractBriefParts,
	extractRequires,
	managedBlockBody,
	parseWorkflowSteps,
	upsertManagedBlock,
	upsertMcpJson,
} from "@/services/handover/HandoverBrief"
import { getHandoverUiState, handoverUiFingerprint, setConductorMode } from "@/services/handover/HandoverUiState"
import { creditFor, deriveIdFromRel, listAllBits, loadBit, resolveBitPath } from "@/services/knowledge/KnowledgeResolver"
import { ATTRIBUTION_FALLBACK, type KbitKind } from "@/services/knowledge/kbit/credit"
import { extractFrontmatter } from "@/services/knowledge/kbit/frontmatter"

const HANDOVER_ROOT = path.join(os.homedir(), ".adsum", "handovers")

interface BriefBit {
	id: string
	title?: string
	version?: string
	/** Display credit — a real curator, or the honest house fallback. Never a placeholder handle. */
	author?: string
	/** True when `author` is a person the bit actually names (the foreign agent shows it either way). */
	attributed?: boolean
	kind?: KbitKind
	steward?: string
	triggers?: string[]
	body: string
	/** BFS depth this bit entered the closure at (0 = a bit the session itself used). */
	hop?: number
	/** The bit whose reference pulled this one in — the "why is this here" provenance. */
	via?: string
	/** internal: the pre-bridge body, used for closure discovery; stripped before the brief is written. */
	_raw?: string
	/** internal: `requires:` ids from frontmatter (bare ids extractBitRefs cannot see). */
	_requires?: string[]
}

export class VscodeHandoverService {
	private tracker?: NodeJS.Timeout
	private offset = 0
	private activeId?: string
	private status?: vscode.StatusBarItem
	private out?: vscode.OutputChannel
	/** Last pushed handover-view fingerprint — the gate that keeps quiet ticks free. */
	private lastUiFingerprint = ""

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

	/** Resolve ONE bit id to its brief entry (body + credit + triggers), or null if nothing serves. Loading
	 *  a bit is also what records its credit facts (manifest for bundled, CATALOG for downloaded — a
	 *  downloaded body carries no frontmatter, since the publisher strips it before hashing). `creditFor`
	 *  applies the honest-fallback rule so a placeholder `author` becomes the authoring team, never a fake
	 *  person. The body is verb-bridged so its "read_file → platforms/X" directives instruct the tool the
	 *  foreign agent actually has (load_skill) — see HandoverBrief.bridgeLoadVerbs. */
	private async loadOneBit(id: string): Promise<BriefBit | null> {
		let body = ""
		try {
			body = (await loadBit(id)) ?? ""
		} catch {}
		let triggers: string[] | undefined
		let requires: string[] | undefined
		try {
			const p = await resolveBitPath(id) // bundled absolute path, or null for a downloaded-only bit
			if (p) {
				const fm = extractFrontmatter(fs.readFileSync(p, "utf8"))
				const t = fm.found && fm.closed ? fm.yaml.match(/^triggers:\s*\[([^\]]*)\]/m)?.[1] : undefined
				if (t) {
					triggers = t.split(",").map((x) => x.trim().replace(/^["']|["']$/g, ""))
				}
				if (fm.found && fm.closed) {
					// `requires:` declares deps as bare ids — the form the prose extractor cannot see. The
					// softAP closure came out right only because prose happened to duplicate it; honor it.
					requires = extractRequires(fm.yaml)
				}
				if (!body) {
					body = fm.body
				}
			}
		} catch {}
		if (!body) {
			return null // nothing to serve — skip rather than hand over an empty skill
		}
		const credit = creditFor(id)
		return {
			id,
			title: credit?.title ?? id.split("/").pop(),
			version: credit?.version,
			author: credit?.author ?? ATTRIBUTION_FALLBACK,
			attributed: credit?.attributed ?? false,
			kind: credit?.kind ?? "knowledge",
			steward: credit?.steward,
			triggers,
			body: bridgeLoadVerbs(id, body),
			// keep the RAW body for closure discovery (references are in the original prose, and bridging
			// rewrote read_file→path away — so extract refs from raw, serve the bridged version)
			_raw: body,
			_requires: requires,
		}
	}

	/**
	 * Collect the closure the handover must carry, so the brief is SELF-SUFFICIENT.
	 *
	 * A workflow is a hub that routes the agent to spokes (find-sample, configure, debug-loop). H1 pinned
	 * only the bits the session had loaded, so the spokes were missing and the agent improvised on raw
	 * sources — the exact gap the softAP live test exposed. So: BFS from the loaded bits over the bits they
	 * REFERENCE (the corpus's prose `platforms/X.md` idiom, extracted by HandoverBrief.extractBitRefs),
	 * ≤2 hops, capped, deduped. Every hop resolves through the same loader → bodies + credit come for free.
	 */
	private async collectBits(relPaths: string[]): Promise<{ bits: BriefBit[]; unresolved: { id: string; via: string }[] }> {
		const HOP_MAX = 2
		const CAP = 20
		const seen = new Set<string>()
		const out: BriefBit[] = []
		// A referenced bit that doesn't serve is LISTED, never silently dropped — "missing" must stay
		// distinguishable from "never referenced" (it also surfaces real corpus dangling links).
		const unresolved: { id: string; via: string }[] = []
		const dedup = (id: string) => {
			if (seen.has(id)) {
				return false
			}
			seen.add(id)
			return true
		}
		let frontier: { id: string; via: string }[] = relPaths
			.map(deriveIdFromRel)
			.filter(dedup)
			.map((id) => ({ id, via: "session" }))
		for (let hop = 0; hop <= HOP_MAX && frontier.length && out.length < CAP; hop++) {
			const next: { id: string; via: string }[] = []
			for (const { id, via } of frontier) {
				if (out.length >= CAP) {
					break
				}
				// Platform-scoped miss → try the core corpus (`adsum/esp/rules/next-step` → `adsum/rules/
				// next-step`): cross-platform rules live at the root, and a platform-relative prose ref
				// resolves wrongly scoped first.
				let bit = await this.loadOneBit(id)
				if (!bit) {
					const core = coreFallbackId(id)
					if (core && !seen.has(core)) {
						bit = await this.loadOneBit(core)
						if (bit) {
							seen.add(core)
						}
					}
				}
				if (!bit) {
					unresolved.push({ id, via })
					continue
				}
				bit.hop = hop
				bit.via = hop === 0 ? undefined : via
				out.push(bit)
				if (hop < HOP_MAX) {
					// prose refs ∪ `requires:` frontmatter — two dependency vocabularies, one closure
					const refs = new Set([...extractBitRefs(bit.id, bit._raw ?? bit.body), ...(bit._requires ?? [])])
					for (const ref of refs) {
						if (!seen.has(ref)) {
							seen.add(ref)
							next.push({ id: ref, via: bit.id })
						}
					}
				}
			}
			frontier = next
		}
		return { bits: out.map(({ _raw, _requires, ...b }) => b), unresolved }
	}

	/** The bit that GOVERNS the mission: the first hop-0 workflow, else the first hop-0 bit. */
	private governingOf(bits: BriefBit[]): BriefBit | undefined {
		return bits.find((b) => b.hop === 0 && /\/workflows\//.test(b.id)) ?? bits.find((b) => b.hop === 0)
	}

	/**
	 * The IDF activation script `adsum.exec`/`adsum.build` will source — resolved AT HANDOVER on the
	 * developer's machine (the Espressif installer's per-version script, the ESP-IDF extension's
	 * configured checkout, or $IDF_PATH). Never installs anything; absence is honestly reported so the
	 * server can tell the agent to ask the developer instead of improvising.
	 */
	private detectIdfActivation(ws: string): string | undefined {
		try {
			const tools = path.join(os.homedir(), ".espressif", "tools")
			const scripts = fs
				.readdirSync(tools)
				.filter((f) => /^activate_idf_.*\.sh$/.test(f))
				.sort()
				.reverse()
			if (scripts[0]) {
				return path.join(tools, scripts[0])
			}
		} catch {}
		try {
			const settings = JSON.parse(fs.readFileSync(path.join(ws, ".vscode", "settings.json"), "utf8"))
			const idfPath = settings["idf.currentSetup"] ?? settings["idf.espIdfPath"]
			if (idfPath && fs.existsSync(path.join(idfPath, "export.sh"))) {
				return path.join(idfPath, "export.sh")
			}
		} catch {}
		const envIdf = process.env.IDF_PATH
		if (envIdf && fs.existsSync(path.join(envIdf, "export.sh"))) {
			return path.join(envIdf, "export.sh")
		}
		return undefined
	}

	/**
	 * Git baseline for the handover — the safety net the softAP run lacked (a foreign agent left a
	 * ZERO-commit repo uncompilable, and nothing could diff or revert it). If the workspace has no
	 * commits, offer — modal, host-side, per the confirm-first rule — to create `snapshot-0`. Returns
	 * what the brief records; `managed: true` means WE own snapshots and may auto-commit at checkpoints.
	 */
	private async ensureGitBaseline(ws: string): Promise<{ ref?: string; managed: boolean }> {
		const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: ws, timeout: 15000 }).toString().trim()
		let hasRepo = false
		let hasCommits = false
		try {
			git("rev-parse --git-dir")
			hasRepo = true
			hasCommits = !!git("rev-parse --verify HEAD 2>/dev/null || true")
		} catch {}
		if (hasCommits) {
			return { ref: git("rev-parse HEAD"), managed: false } // the developer's own history is the baseline
		}
		const pick = await vscode.window.showWarningMessage(
			hasRepo
				? "Adsum: this project has a git repo but no commits — your coding agent's edits would have no baseline to diff or revert against. Create a baseline commit (snapshot-0) before handing over?"
				: "Adsum: this project has no git history — your coding agent's edits would be untracked and unrevertable. Initialize git and create a baseline commit (snapshot-0) before handing over?",
			{ modal: true },
			"Create baseline",
			"Hand over without it",
		)
		if (pick !== "Create baseline") {
			return { managed: false }
		}
		try {
			if (!hasRepo) {
				git("init")
			}
			git("add -A")
			execSync(`git -c user.name=Adsum -c user.email=adsum@local commit -m "adsum snapshot-0 (handover baseline)"`, {
				cwd: ws,
				timeout: 30000,
			})
			return { ref: git("rev-parse HEAD"), managed: true }
		} catch (e) {
			vscode.window.showWarningMessage(`Adsum: baseline commit failed (${e}); handing over without one.`)
			return { managed: false }
		}
	}

	/** Close out older pending handovers so a fresh one is the only thing in the inbox. */
	private supersedeStalePending(): void {
		try {
			for (const e of fs.readdirSync(HANDOVER_ROOT, { withFileTypes: true })) {
				if (!e.isDirectory()) {
					continue
				}
				const sp = path.join(HANDOVER_ROOT, e.name, "state.json")
				try {
					const st = JSON.parse(fs.readFileSync(sp, "utf8"))
					if (st.status === "pending") {
						fs.writeFileSync(
							sp,
							JSON.stringify({ ...st, status: "superseded", supersededAt: new Date().toISOString() }, null, 1),
						)
					}
				} catch {}
			}
		} catch {}
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
		const { bits, unresolved } = await this.collectBits(parts.kbitRelPaths)
		// The three-layer payload: ★ governing (marked, steps parsed) · ◆ closure (bodies, hop/via) ·
		// ≡ manifest index (metadata-only field of view; bodies on demand via load_skill).
		const governing = this.governingOf(bits)
		const steps = governing ? parseWorkflowSteps(governing.body) : []
		const inClosure = new Set(bits.map((b) => b.id))
		const index = (await listAllBits())
			.filter((e) => !inClosure.has(e.id))
			.map(({ id, title, author, version, kind, platform, path: p }) => ({
				id,
				title,
				author,
				version,
				kind,
				platform,
				path: p,
			}))
		// Safety net + environment facts the server's t-bits need (resolved here; the server stays dumb).
		const baseline = await this.ensureGitBaseline(ws)
		const idfActivate = this.detectIdfActivation(ws)
		// Supersede any older still-pending handovers: a stale 'pending' from an attempt that never got
		// picked up would otherwise clutter `inbox` and make "which one?" ambiguous (it bit us twice in
		// testing). Only 'pending' is closed — an 'active' session the agent is really working stays.
		this.supersedeStalePending()

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
					governing: governing?.id,
					steps,
					bits,
					unresolved,
					index,
					baseline,
					idf: idfActivate ? { activate: idfActivate } : undefined,
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

		// INBOX-FIRST (the Studio pattern): the handover is now POSTED — the brief on disk IS the inbox
		// entry, and any agent session connected to the adsum MCP server pulls it with the `inbox` tool.
		// We deliberately do NOT spawn a terminal by default: launching a binary we don't own (PATH,
		// versions, login shells) is the fragile path, and most developers already have their agent open.
		// The pickup prompt goes to the clipboard so the developer just pastes it into their agent.
		const pickup = `Check the Adsum inbox and pick up handover ${id} (adsum MCP tools: inbox → resume_handover).`
		await vscode.env.clipboard.writeText(pickup)
		this.startTracking(id)
		this.pushUiState(true) // the strip appears immediately, in "posted" state
		const note = blockResult === "skipped-user-edited" ? " (CLAUDE.md block left as you edited it)" : ""
		const pick = await vscode.window.showInformationMessage(
			`Handover ${id} posted to your agent's Adsum inbox${note}. In your Claude Code session, paste the prompt (already copied) — or just say "check the Adsum inbox". New session? It needs a restart to load the adsum MCP server.`,
			"Watch progress",
			"Copy prompt again",
			"Launch a new Claude Code",
		)
		if (pick === "Watch progress") {
			this.out?.show(true)
		} else if (pick === "Copy prompt again") {
			await vscode.env.clipboard.writeText(pickup)
		} else if (pick === "Launch a new Claude Code") {
			// Fallback for the cold start (no agent session running): resolve the REAL binary — `claude`
			// is usually not on PATH (it ships inside the Claude Code extension) — and hand it the opening
			// turn, because a bare interactive launch would sit waiting forever.
			const cli = this.resolveAgentCli()
			const term = vscode.window.createTerminal({ name: "Claude Code — Adsum handover", cwd: ws })
			term.sendText(`${JSON.stringify(cli.cmd)} ${JSON.stringify(pickup)}`)
			term.show()
			if (!cli.bundled) {
				vscode.window.showWarningMessage(
					'Adsum: Claude Code\'s bundled binary was not found — the terminal runs "claude" from your PATH. If it says "command not found", install Claude Code.',
				)
			}
		}
	}

	// ── host-side working-tree watcher: truth the agent never has to volunteer ──
	/**
	 * The ledger only records what the agent reports over MCP — the softAP run proved work continues
	 * invisibly after the last call (state froze at 19:06 while an install + three file mutations
	 * followed). The extension sits on the SAME workspace, so it watches the tree itself: dirty-file
	 * deltas go to observations.jsonl, and when WE own the baseline (snapshot-0), each checkpoint gets a
	 * snapshot commit — the reverse handoff is then a diff, not a memory.
	 */
	private observeTree(id: string, ws: string, lastDirty: { v: string }): void {
		let dirty = ""
		try {
			dirty = execSync("git status --porcelain", { cwd: ws, timeout: 10000 }).toString().trim()
		} catch {
			return // no repo / git unavailable — nothing to observe
		}
		if (dirty === lastDirty.v) {
			return
		}
		lastDirty.v = dirty
		const files = dirty
			.split("\n")
			.filter(Boolean)
			.map((l) => l.slice(3))
		try {
			fs.appendFileSync(
				path.join(HANDOVER_ROOT, id, "observations.jsonl"),
				JSON.stringify({ t: new Date().toISOString(), event: "tree_change", files }) + "\n",
			)
		} catch {}
		this.out?.appendLine(
			`⇢ working tree: ${files.length} file${files.length === 1 ? "" : "s"} modified (${files.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""})`,
		)
	}

	/** Append a fact WE observed. The UI builder is pure and never shells out, so anything learned by
	 *  running something (a snapshot commit, a diffstat) is recorded here and only read there. */
	private observe(id: string, event: Record<string, unknown>): void {
		try {
			fs.appendFileSync(
				path.join(HANDOVER_ROOT, id, "observations.jsonl"),
				JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n",
			)
		} catch {}
	}

	private snapshotAtCheckpoint(id: string, ws: string, worklog: string): void {
		let managed = false
		try {
			managed = !!JSON.parse(fs.readFileSync(path.join(HANDOVER_ROOT, id, "brief.json"), "utf8")).baseline?.managed
		} catch {}
		if (!managed) {
			return // the developer's own git history — never commit into it uninvited
		}
		try {
			execSync("git add -A", { cwd: ws, timeout: 15000 })
			execSync(
				`git -c user.name=Adsum -c user.email=adsum@local commit -m ${JSON.stringify(`adsum snapshot: ${worklog.slice(0, 72)}`)} --allow-empty`,
				{ cwd: ws, timeout: 30000 },
			)
			this.observe(id, { event: "snapshot" })
			this.out?.appendLine(`⎘ snapshot committed at checkpoint`)
		} catch {}
	}

	/** Measure what actually changed, once, when the agent closes out. This is the "Adsum saw" column
	 *  of the receipt — present even if the agent reported nothing at all. */
	private recordDiffstat(id: string): void {
		try {
			const brief = JSON.parse(fs.readFileSync(path.join(HANDOVER_ROOT, id, "brief.json"), "utf8"))
			if (!brief.workspace) {
				return
			}
			const range = brief.baseline?.ref ? `${brief.baseline.ref}..HEAD` : ""
			const text = execSync(`git diff --shortstat ${range} 2>/dev/null || git diff --shortstat`, {
				cwd: brief.workspace,
				timeout: 15000,
			})
				.toString()
				.trim()
			if (text) {
				this.observe(id, { event: "diffstat", text })
			}
		} catch {}
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
		let ticks = 0
		const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		const lastDirty = { v: "" }
		// Show the indicator immediately: "we are watching, the agent hasn't called yet" is real state and
		// far more useful than an empty status bar that looks like the command did nothing.
		this.status.text = `$(broadcast) Adsum ⇄ agent · waiting`
		this.status.tooltip = "Handed-over session: waiting for your coding agent to call an Adsum tool. Click to watch."
		this.status.command = "adsum-iot-coder.watchHandover"
		this.status.show()
		this.tracker = setInterval(() => {
			// Every 5th tick (~15 s), look at the tree itself — the agent's edits show here whether or
			// not it ever reports them.
			if (ws && ++ticks % 5 === 0) {
				this.observeTree(id, ws, lastDirty)
			}
			const f = path.join(HANDOVER_ROOT, id, "ledger.jsonl")
			let text = ""
			try {
				const stat = fs.statSync(f)
				if (stat.size <= this.offset) {
					// no new events: after 10 quiet minutes stop claiming "live"
					if (Date.now() - lastEventAt > 600_000 && this.status) {
						this.status.text = `$(circle-outline) Adsum ⇄ agent · idle`
					}
					this.pushUiState() // cheap: no-ops unless the fingerprint moved (e.g. the tree watcher fired)
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
					this.out?.appendLine(
						`⚒ loaded ${e.id}   ◆ ${e.title ?? ""} — curated by ${e.author ?? "the Adsum authoring team"}`,
					)
				} else if (e.event === "checkpoint") {
					const step = e.step && e.step !== "off-plan" ? ` [${e.step}]` : ""
					this.out?.appendLine(`✓ checkpoint${step}: ${e.worklog}${e.final ? "  (closing)" : ""}`)
					vscode.window.setStatusBarMessage(`Adsum ⇄ agent: ${e.worklog}`, 6000)
					if (ws) {
						this.snapshotAtCheckpoint(id, ws, e.worklog ?? "")
					}
					// The agent closed out: measure what actually changed, once, for the receipt.
					if (e.final) {
						this.recordDiffstat(id)
					}
				} else if (e.event === "tool_exec" || e.event === "tool_build") {
					this.out?.appendLine(`⚙ ${e.event === "tool_build" ? "build" : "exec"}: ${e.command ?? ""} → exit ${e.exit}`)
				}
			}
			this.pushUiState()
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
		const closing = events.filter((e) => e.event === "checkpoint" && e.final).pop()
		// Host-observed facts — present even when the agent reported nothing (the softAP lesson).
		let observed = ""
		try {
			if (brief.baseline?.ref && brief.workspace) {
				const stat = execSync(`git diff --stat ${brief.baseline.ref}..HEAD 2>/dev/null || git diff --stat`, {
					cwd: brief.workspace,
					timeout: 15000,
				})
					.toString()
					.trim()
					.split("\n")
					.pop()
				if (stat) {
					observed = `Code changed since the baseline (host-measured): ${stat}`
				}
			}
		} catch {}
		const prompt = [
			`Continue this task — it was handed to my coding agent and I'm bringing it back.`,
			"",
			`Original mission: ${brief.mission ?? "(unknown)"}`,
			brief.worklog?.length ? `Done before handover:\n${brief.worklog.map((w: string) => `- ${w}`).join("\n")}` : "",
			checkpoints.length
				? `Done in the external agent:\n${checkpoints.map((c) => `- ${c}`).join("\n")}`
				: "- (the external agent recorded no checkpoints)",
			closing?.files_touched?.length ? `Files it says it touched: ${closing.files_touched.join(", ")}` : "",
			closing?.next_step ? `Its stated next step: ${closing.next_step}` : "",
			observed,
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

	// ── conductor mode: no inference on our side? handover IS the execution path ──
	/**
	 * "Conductor" = Adsum has no model to run cards with (no provider configured, or the developer set
	 * the mode explicitly) — so the DEFAULT way to execute is: hand to the developer's own agent, keep
	 * conducting (knowledge, environment tools, interrogation, snapshots). The handover plane never
	 * calls an inference API — a hard invariant, enforced by test — so this mode needs zero tokens.
	 */
	async detectConductorMode(): Promise<{ conductor: boolean; reason: string }> {
		const override = vscode.workspace.getConfiguration("adsum-iot-coder").get<string>("conductorMode", "auto")
		if (override === "always") {
			return { conductor: true, reason: "set by you (conductorMode: always)" }
		}
		if (override === "off") {
			return { conductor: false, reason: "disabled in settings" }
		}
		// auto — evidence-based, in order of certainty:
		// 1. The free tier IS inference. Guessed secret names missed it live (the panel showed 9M free
		//    tokens while the toggle claimed "needs a model") — read the same cache the FreeTierStrip does.
		const freeTokens = getFreeTierTokensForDisplay()
		if (freeTokens !== undefined && freeTokens > 0) {
			return { conductor: false, reason: "free tier active" }
		}
		// 2. A configured provider key (BYOK). Probe the common secret slots.
		const provider = this.context.globalState.get<string>("apiProvider")
		const secretKeys = ["apiKey", "openRouterApiKey", "openAiApiKey", "anthropicApiKey", "geminiApiKey"]
		for (const k of secretKeys) {
			try {
				if (await this.context.secrets.get(k)) {
					return { conductor: false, reason: `inference available (${provider ?? "provider configured"})` }
				}
			} catch {}
		}
		if (freeTokens !== undefined) {
			return { conductor: true, reason: "free tier used up, no key added" }
		}
		return { conductor: true, reason: "no inference provider configured" }
	}

	/** Refresh the cached conductor verdict (it needs secrets, which the pure UI builder cannot touch). */
	async refreshConductorCache(): Promise<void> {
		try {
			const { conductor, reason } = await this.detectConductorMode()
			setConductorMode({ active: conductor, reason })
			this.pushUiState(true)
		} catch {}
	}

	/**
	 * Push the handover view to the webview — but only when it actually changed. The tracker ticks every
	 * 3 s and ExtensionState is fat; a quiet tick must cost nothing.
	 */
	private pushUiState(force = false): void {
		try {
			const next = getHandoverUiState(HANDOVER_ROOT)
			const fp = handoverUiFingerprint(next)
			if (!force && fp === this.lastUiFingerprint) {
				return
			}
			this.lastUiFingerprint = fp
			// Lazy import keeps this host service out of the controller's construction order.
			const { WebviewProvider } = require("@/core/webview") as typeof import("@/core/webview")
			void WebviewProvider.getInstance()?.controller?.postStateToWebview()
		} catch {}
	}

	/** One-time hint at activation: in conductor mode the handover is the front door, not a fallback. */
	async announceConductorMode(): Promise<void> {
		const { conductor, reason } = await this.detectConductorMode()
		if (!conductor || this.context.globalState.get("adsum.conductorAnnounced")) {
			return
		}
		await this.context.globalState.update("adsum.conductorAnnounced", true)
		const pick = await vscode.window.showInformationMessage(
			`Adsum is in conductor mode (${reason}): cards run on your own coding agent — Adsum hands over the mission, curated knowledge and toolchain commands, tracks every step, and keeps snapshots. No Adsum tokens are used.`,
			"Hand a session over now",
			"OK",
		)
		if (pick === "Hand a session over now") {
			await this.handOver()
		}
	}

	// ── the worklog view: the card-menu rendering of the handed-away session ─
	async showWorklog(id?: string): Promise<void> {
		const hid = id ?? this.activeId ?? this.newestHandoverId()
		if (!hid) {
			vscode.window.showInformationMessage("Adsum: no handover to show.")
			return
		}
		const dir = path.join(HANDOVER_ROOT, hid)
		const brief = (() => {
			try {
				return JSON.parse(fs.readFileSync(path.join(dir, "brief.json"), "utf8"))
			} catch {
				return {}
			}
		})()
		const read = (f: string) => {
			try {
				return fs
					.readFileSync(path.join(dir, f), "utf8")
					.split("\n")
					.filter(Boolean)
					.map((l) => JSON.parse(l))
			} catch {
				return []
			}
		}
		const events = read("ledger.jsonl")
		const obs = read("observations.jsonl")
		const lines = [
			`# Handover ${hid} — worklog`,
			"",
			`**Mission:** ${brief.mission ?? "?"}`,
			brief.governing ? `**Governing workflow:** ${brief.governing}` : "",
			"",
			"## Milestones (agent-reported)",
			...events
				.filter((e) => e.event === "checkpoint")
				.map(
					(e) =>
						`- ${e.t} — ${e.step && e.step !== "off-plan" ? `**[${e.step}]** ` : ""}${e.worklog}${e.final ? " *(closing)*" : ""}`,
				),
			"",
			"## Knowledge used",
			...events.filter((e) => e.event === "kbit_load").map((e) => `- ${e.id} — ${e.title ?? ""} (by ${e.author ?? "?"})`),
			"",
			"## Toolchain commands (through Adsum)",
			...events
				.filter((e) => e.event === "tool_exec" || e.event === "tool_build")
				.map((e) => `- \`${e.command}\` → exit ${e.exit}`),
			"",
			"## Working-tree changes (host-observed — agent cooperation not required)",
			...obs.slice(-20).map((o) => `- ${o.t} — ${o.files?.length ?? 0} file(s): ${(o.files ?? []).slice(0, 6).join(", ")}`),
		].filter((l) => l !== "")
		const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") })
		await vscode.window.showTextDocument(doc, { preview: true })
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
		this.pushUiState(true) // status is now 'returned' → the strip unmounts on this push
	}

	dispose(): void {
		this.stopTracking()
		this.status?.dispose()
		this.out?.dispose()
	}
}
