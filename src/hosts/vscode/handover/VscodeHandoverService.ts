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
import { prepareCraBundle, prepareDemoWorkspace } from "@/core/demos/DemoManager"
import { StateManager } from "@/core/storage/StateManager"
import { getFreeTierTokensForDisplay } from "@/services/adsum/FreeTierState"
import { detectClaudeCode, installMcpServer } from "@/services/handover/AgentSetup"
import {
	bridgeLoadVerbs,
	coreFallbackId,
	extractBitRefs,
	extractBriefParts,
	extractRequires,
	managedBlockBody,
	parseWorkflowSteps,
	upsertManagedBlock,
} from "@/services/handover/HandoverBrief"
import { getHandoverUiState, handoverUiFingerprint, setAgentFacts, setConductorMode } from "@/services/handover/HandoverUiState"
import { creditFor, deriveIdFromRel, listAllBits, loadBit, resolveBitPath } from "@/services/knowledge/KnowledgeResolver"
import { ATTRIBUTION_FALLBACK, type KbitKind } from "@/services/knowledge/kbit/credit"
import { extractFrontmatter } from "@/services/knowledge/kbit/frontmatter"
import { getCachedWorkspaceSummary } from "@/services/platform/WorkspaceClassifier"

const HANDOVER_ROOT = path.join(os.homedir(), ".adsum", "handovers")

interface BriefBit {
	id: string
	title?: string
	version?: string
	/** Display credit — a real curator, or the honest house fallback. Never a placeholder handle. */
	author?: string
	/** True when `author` is a person the bit actually names (the foreign agent shows it either way). */
	attributed?: boolean
	/** Co-authors the bit names — credit travels with the bit into the foreign agent's context. */
	coAuthors?: string[]
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
			coAuthors: credit?.coAuthors?.length ? credit.coAuthors : undefined,
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
	private async ensureGitBaseline(ws: string, auto = false): Promise<{ ref?: string; managed: boolean }> {
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
		if (auto) {
			// OUR materialized sample copy, not the developer's project — baseline without asking.
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
			} catch {
				return { managed: false }
			}
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

	/** The external-agent provider's setup preferences, with the D2 defaults applied. */
	private agentPrefs(): { kind: "claude-code" | "other"; autoMcp: boolean; manageClaudeMd: boolean; writeAgentsMd: boolean } {
		try {
			const cfg = StateManager.get().getApiConfiguration() as any
			return {
				kind: cfg.externalAgentKind === "other" ? "other" : "claude-code",
				autoMcp: cfg.externalAgentAutoMcp !== false,
				manageClaudeMd: cfg.externalAgentManageClaudeMd !== false,
				writeAgentsMd: cfg.externalAgentWriteAgentsMd === true,
			}
		} catch {
			return { kind: "claude-code", autoMcp: true, manageClaudeMd: true, writeAgentsMd: false }
		}
	}

	/** Where Claude Code's VS Code extension may live — evidence for detectClaudeCode (a bundled binary
	 *  under any versioned extension dir). vscode.* is legal here; the detector itself stays pure. */
	private claudeExtensionPaths(): string[] {
		const out: string[] = []
		try {
			const ext = vscode.extensions.getExtension("anthropic.claude-code")
			if (ext) {
				out.push(ext.extensionPath)
			}
		} catch {}
		try {
			const root = path.join(os.homedir(), ".vscode", "extensions")
			for (const d of fs.readdirSync(root)) {
				if (d.startsWith("anthropic.claude-code-")) {
					out.push(path.join(root, d))
				}
			}
		} catch {}
		return out
	}

	/** The workflow that governs each agent-runnable card, per platform — the closure seed for a
	 *  card-started handover. Ids must exist in the corpus; a miss is honestly listed as unresolved. */
	private static readonly CARD_WORKFLOWS: Record<string, Partial<Record<"esp" | "nrf", string>>> = {
		buildFlashDebug: { esp: "platforms/esp/workflows/debug-loop.md", nrf: "platforms/nrf/workflows/debug-loop.md" },
		addFeature: { esp: "platforms/esp/workflows/add-feature.md", nrf: "platforms/nrf/workflows/add-feature.md" },
		testValidate: { esp: "platforms/esp/workflows/test-validate.md", nrf: "platforms/nrf/workflows/test-validate.md" },
		craCheck: { esp: "platforms/cra/workflows/cra-readiness.md", nrf: "platforms/cra/workflows/cra-readiness.md" },
	}

	private async parseCardPayload(
		payload?: string,
	): Promise<{ prompt: string; workflowRels: string[]; workspace?: string; autoBaseline?: boolean } | null> {
		if (!payload) {
			return null
		}
		try {
			const p = JSON.parse(payload)
			// A SAMPLE handover: materialize the pristine bundled sample (the same copy a local demo run
			// uses) and hand THAT project over. The sample is the zero-risk first handover — a known
			// project with a known bug, so the developer can experience the whole loop without exposing
			// their own code. Our throwaway copy → the git baseline is created without asking.
			if (p.demo === "nus-uart") {
				const dws = await prepareDemoWorkspace()
				return {
					prompt: [
						"Debug a real BLE NUS bug in this sample NCS workspace: the central and peripheral connect,",
						"but data flows ONE WAY only. Find why and fix it in the source.",
						"Recorded logs from real nRF hardware (nRF52840DK + nRF5340DK) are in the project — ground",
						"every claim in those logs and the source; do not invent hardware runs.",
					].join(" "),
					workflowRels: ["platforms/nrf/workflows/demo-debug.md"],
					workspace: dws.rootPath,
					autoBaseline: true,
				}
			}
			if (p.demo === "cra-sample") {
				const bundle = await prepareCraBundle("nrf")
				return {
					prompt: [
						"Run the CRA readiness workflow on this pre-built reference firmware bundle:",
						"produce the SBOM, a secure-by-design posture preview, and a readiness check.",
						"Ground every finding in the bundle's real artifacts — never assert compliance,",
						"describe evidence and let the developer decide.",
					].join(" "),
					workflowRels: ["platforms/cra/workflows/cra-readiness.md"],
					workspace: bundle,
					autoBaseline: true,
				}
			}
			// No prompt (e.g. the quota card's "continue on my agent"): fall through to the current
			// session's brief — the developer is continuing work, not starting a card.
			if (typeof p?.prompt !== "string" || !p.prompt.trim()) {
				return null
			}
			const map = VscodeHandoverService.CARD_WORKFLOWS[String(p.intentId)] ?? {}
			const platforms: ("esp" | "nrf")[] = p.platform === "both" ? ["esp", "nrf"] : [p.platform]
			const workflowRels = [...new Set(platforms.map((pl) => map[pl]).filter(Boolean))] as string[]
			return { prompt: p.prompt.trim(), workflowRels }
		} catch {
			return null
		}
	}

	// ── the command: hand over ───────────────────────────────────────────────
	async handOver(cardPayload?: string): Promise<void> {
		// A CARD started this handover: its prompt IS the mission, and its workflow seeds the closure.
		// Without this, a card click inherited the newest session's mission and bits — the "Test &
		// validate" door could post a "debug BLE" brief (seen live on the F5 strip). A SAMPLE card also
		// brings its own materialized workspace.
		const card = await this.parseCardPayload(cardPayload)
		const ws = card?.workspace ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!ws) {
			vscode.window.showWarningMessage("Adsum: open a project folder before handing a session over.")
			return
		}
		let parts = { mission: "", worklog: [] as string[], nextStep: "", lastSummary: "", kbitRelPaths: [] as string[] }
		if (card) {
			parts.mission = card.prompt
			parts.kbitRelPaths = card.workflowRels
		} else {
			const taskDir = this.newestTaskDir()
			if (taskDir) {
				try {
					const ui = JSON.parse(fs.readFileSync(path.join(taskDir, "ui_messages.json"), "utf8"))
					const meta = JSON.parse(fs.readFileSync(path.join(taskDir, "task_metadata.json"), "utf8"))
					parts = extractBriefParts(ui, meta)
				} catch {}
			}
		}
		// A handover with no prior session is legitimate (hand over a fresh card) — the brief is just thinner.
		const { bits, unresolved } = await this.collectBits(parts.kbitRelPaths)
		// The three-layer payload: ★ governing (marked, steps parsed) · ◆ closure (bodies, hop/via) ·
		// ≡ manifest index (metadata-only field of view; bodies on demand via load_skill).
		const governing = this.governingOf(bits)
		const steps = governing ? parseWorkflowSteps(governing.body) : []
		const inClosure = new Set(bits.map((b) => b.id))
		// Field of view, not the whole warehouse: a live ESP pickup listed 62 rows of which 38 were nRF
		// boards, BLE sniffers and NCS SDK bits — ~1.3k tokens of noise before the agent read a word of
		// the mission. Keep this workspace's platform plus the cross-platform corpus; the rest stays one
		// load_skill away and the count of what was set aside is stated honestly.
		const plat = getCachedWorkspaceSummary()
		const keepPlatform = (id: string) => {
			const seg = id.replace(/^adsum\//, "").split("/")[0]
			if (["rules", "references", "knowledges", "agent", "core", "cra"].includes(seg)) {
				return true
			}
			return plat === "both" || plat === undefined || plat === "none" ? true : seg === plat
		}
		const allBits = (await listAllBits()).filter((e) => !inClosure.has(e.id))
		const index = allBits
			.filter((e) => keepPlatform(e.id))
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
		const baseline = await this.ensureGitBaseline(ws, card?.autoBaseline)
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
					indexFilteredOut: allBits.length - index.length,
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

		// Wire the project: register the MCP server in the agent's own config + the managed block.
		// serverPath points INSIDE the running install, never at a repo working tree — a config aimed at
		// a checkout silently changes meaning when a branch is switched (it bit us in testing).
		const serverPath = path.join(this.context.extensionPath, "mcp", "adsum-mcp.mjs")
		// The external-agent provider's setup preferences (mcp-sdk/13 D2). Defaults are the ON path;
		// every OFF is honored AND stated in the toast — a skipped setup must never look like a done one.
		const prefs = this.agentPrefs()
		// Only claim an automatic setup for an agent we can actually see on this machine; otherwise say
		// what to add, rather than writing a config for a client that may not exist.
		const claude = detectClaudeCode(this.claudeExtensionPaths())
		const setup = prefs.autoMcp
			? installMcpServer({
					agent: claude.present && prefs.kind !== "other" ? "claude-code" : "other",
					workspace: ws,
					serverPath,
				})
			: ({ status: "skipped", needsSessionRestart: false } as const)
		const blockResult = prefs.manageClaudeMd
			? upsertManagedBlock(path.join(ws, "CLAUDE.md"), managedBlockBody(id))
			: ("skipped" as const)
		if (prefs.writeAgentsMd) {
			// The same fingerprint-guarded block into the cross-agent convention file — how a non-Claude
			// agent gets the same standing instructions with zero new machinery.
			upsertManagedBlock(path.join(ws, "AGENTS.md"), managedBlockBody(id))
		}

		// INBOX-FIRST (the Studio pattern): the handover is now POSTED — the brief on disk IS the inbox
		// entry, and any agent session connected to the adsum MCP server pulls it with the `inbox` tool.
		// We deliberately do NOT spawn a terminal by default: launching a binary we don't own (PATH,
		// versions, login shells) is the fragile path, and most developers already have their agent open.
		// The pickup prompt goes to the clipboard so the developer just pastes it into their agent.
		const pickup = `Check the Adsum inbox and pick up handover ${id} (adsum MCP tools: inbox → resume_handover).`
		await vscode.env.clipboard.writeText(pickup)
		this.startTracking(id)
		this.pushUiState(true) // the strip appears immediately, in "posted" state
		const note =
			blockResult === "skipped-user-edited"
				? " (CLAUDE.md block left as you edited it)"
				: blockResult === "skipped"
					? " (CLAUDE.md guidance is off in your agent settings)"
					: ""
		// Say what we set up, and the one manual beat we cannot do for them: an agent loads its MCP
		// servers at session start, so a session that is already open will not see Adsum until restarted.
		const setupNote =
			setup.status === "installed" || setup.status === "updated"
				? " Adsum is now registered with Claude Code for this project — a NEW agent session picks it up (restart an open one)."
				: setup.status === "already"
					? ""
					: setup.status === "failed"
						? ` Could not write ${setup.configPath} — add the adsum MCP server manually.`
						: setup.status === "unsupported"
							? " Claude Code was not found here — add the adsum MCP server to your agent's config to connect it."
							: setup.status === "skipped"
								? " MCP auto-setup is off in your agent settings — the adsum server must already be configured in your agent."
								: ""
		const pick = await vscode.window.showInformationMessage(
			`Handover ${id} posted to your agent's Adsum inbox${note}.${setupNote} In your Claude Code session, paste the prompt (already copied) — or just say "check the Adsum inbox". New session? It needs a restart to load the adsum MCP server.`,
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

	/**
	 * Re-arm tracking after a VS Code restart. The agent's side never pauses — its MCP server is spawned
	 * by the AGENT's process, so the ledger keeps recording with VS Code closed — but OUR witnessing
	 * (tree observations, snapshot-per-checkpoint, the diffstat) stops with the window, and nothing
	 * restarted it: startTracking was only ever called by handOver(). Called at activation.
	 *
	 * Resumes with the ledger FAST-FORWARDED: a fresh tracker starts at offset 0, which would replay the
	 * whole history — re-logging every event and re-snapshotting every old checkpoint. History is already
	 * on disk and already rendered; only NEW events may trigger side effects.
	 */
	resumeTrackingIfActive(): void {
		if (this.tracker) {
			return // already live (this window did the handover)
		}
		const strip = getHandoverUiState(HANDOVER_ROOT).strip
		if (!strip || strip.phase === "closed") {
			return // nothing in flight — closed sessions only need "Continue here", not a live tracker
		}
		this.startTracking(strip.id, { resume: true })
	}

	// ── tracking: the ledger is the only honest record ───────────────────────
	private startTracking(id: string, opts?: { resume?: boolean }): void {
		this.stopTracking()
		this.activeId = id
		// A resumed tracker skips history: everything before this size already happened, was already
		// shown, and must not re-fire snapshots. A fresh handover's ledger is empty, so 0 is exact there.
		this.offset = opts?.resume ? this.ledgerSize(id) : 0
		this.out ??= vscode.window.createOutputChannel("Adsum Handover")
		this.status ??= vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
		if (!opts?.resume) {
			this.out.show(true)
		}
		this.out.appendLine(
			opts?.resume
				? `— handover ${id} — tracking resumed (window restarted; the agent's record never paused) —`
				: `— handover ${id} — watching what your agent does with it —`,
		)
		if (!opts?.resume) {
			this.out.appendLine(
				`  (nothing appears here until the agent calls an adsum tool — approve the MCP server if prompted)`,
			)
		}
		let calls = 0
		let lastEventAt = Date.now()
		let ticks = 0
		// Observe the workspace the handover is ABOUT (a sample handover materializes its own copy) —
		// the folder VS Code happens to have open is only the fallback.
		let briefWs: string | undefined
		try {
			briefWs = JSON.parse(fs.readFileSync(path.join(HANDOVER_ROOT, id, "brief.json"), "utf8")).workspace
		} catch {}
		const ws = briefWs ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
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
					// The agent closed out: measure what actually changed, once, for the receipt — and give
					// the finished session its place in task history.
					if (e.final) {
						this.recordDiffstat(id)
						this.ensureSessionInHistory(id)
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

	private ledgerSize(id: string): number {
		try {
			return fs.statSync(path.join(HANDOVER_ROOT, id, "ledger.jsonl")).size
		} catch {
			return 0
		}
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
		this.writeSessionRecord(hid) // the prompt points at it, so it must exist first
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
		// Anything the developer typed while the agent was away must come BACK with them — in the field
		// two "continue" messages sat undelivered on disk while the agent had already stopped.
		let undelivered: string[] = []
		try {
			undelivered = fs
				.readFileSync(path.join(dir, "messages.jsonl"), "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l).text)
				.filter((t) => typeof t === "string")
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
			undelivered.length
				? `I typed these while the agent was away — it never received them:\n${undelivered.map((m) => `- ${m}`).join("\n")}`
				: "",
			`(Full record of the agent's session: ${path.join(HANDOVER_ROOT, hid, "worklog.md")})`,
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

	/** Queue a message for the agent. The server delivers it in the response to the agent's next
	 *  milestone and records the delivery in the ledger — the queue file only ever holds the undelivered. */
	async messageAgent(text: string): Promise<void> {
		const id = this.activeId ?? this.newestHandoverId()
		if (!id) {
			vscode.window.showInformationMessage("Adsum: no handed-over session to message.")
			return
		}
		try {
			fs.appendFileSync(
				path.join(HANDOVER_ROOT, id, "messages.jsonl"),
				JSON.stringify({ t: new Date().toISOString(), text }) + "\n",
			)
			this.out?.appendLine(`✉ queued for the agent: ${text.slice(0, 80)}`)
			this.pushUiState(true) // the "you" turn appears immediately, marked queued
		} catch (e) {
			vscode.window.showWarningMessage(`Adsum: could not queue the message (${e}).`)
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
		// 1. The free tier IS inference — read the same cache the FreeTierStrip renders.
		const freeTokens = getFreeTierTokensForDisplay()
		if (freeTokens !== undefined && freeTokens > 0) {
			return { conductor: false, reason: "free tier active" }
		}
		// 2. Any configured provider. Never guess secret names (a 5-name probe missed GLM's zaiApiKey and
		//    ~35 other slots live) — ask the SAME assembled configuration the app runs tasks with, and
		//    count any populated credential field, or a local provider that needs none.
		try {
			const cfg = StateManager.get().getApiConfiguration() as Record<string, unknown>
			const CRED = /(apikey|accesskey|secretkey|sessiontoken|clientsecret|refreshtoken)$/i
			const hasCredential = Object.entries(cfg).some(
				([k, v]) => CRED.test(k) && typeof v === "string" && v.trim().length > 0,
			)
			const providers = [cfg.planModeApiProvider, cfg.actModeApiProvider].filter(Boolean).map(String)
			const KEYLESS = new Set(["ollama", "lmstudio", "vscode-lm"])
			if (hasCredential || providers.some((p) => KEYLESS.has(p))) {
				return { conductor: false, reason: `inference available (${providers[0] ?? "provider configured"})` }
			}
		} catch {
			// StateManager not initialized yet — fall through to the honest default below
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
			// Same refresh point resolves whether an auto-configurable agent is here (drives the
			// external-agent settings panel's detection line). Host-side; the webview never probes fs.
			setAgentFacts(detectClaudeCode(this.claudeExtensionPaths()))
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

	/**
	 * An agent session IS a session (operator ruling 2026-07-20): once the agent closes it, it must exist
	 * where every other session lives — the task history list — instead of evaporating with the live strip
	 * 48h later. The row carries handoverId so the webview routes it to the session view (there is no task
	 * directory behind it), and zero token/cost fields that are never rendered.
	 *
	 * Idempotent via state.json's historyEntry flag, so the three callers can overlap safely:
	 * the tracker's final-checkpoint branch (window open when the agent finishes), markReturned (the
	 * pre-flag path for sessions continued in Adsum), and the activation sweep (agent finished while no
	 * window was open — plus the backfill for sessions closed before this shipped).
	 */
	private ensureSessionInHistory(id: string): void {
		try {
			const stateFile = path.join(HANDOVER_ROOT, id, "state.json")
			const state = JSON.parse(fs.readFileSync(stateFile, "utf8"))
			if (!["closed-by-agent", "returned"].includes(state.status) || state.historyEntry) {
				return
			}
			// the durable markdown record too — a session that never comes back still leaves one
			if (!fs.existsSync(path.join(HANDOVER_ROOT, id, "worklog.md"))) {
				this.writeSessionRecord(id)
			}
			let mission = ""
			try {
				mission = JSON.parse(fs.readFileSync(path.join(HANDOVER_ROOT, id, "brief.json"), "utf8")).mission ?? ""
			} catch {}
			const sm = StateManager.get()
			const history = sm.getGlobalStateKey("taskHistory") ?? []
			if (!history.some((h) => h.id === id)) {
				sm.setGlobalState("taskHistory", [
					...history,
					{
						id,
						handoverId: id,
						ts: Date.parse(state.closedAt ?? "") || Date.now(),
						task: mission || "Session worked by your coding agent",
						tokensIn: 0,
						tokensOut: 0,
						totalCost: 0,
					},
				])
			}
			fs.writeFileSync(stateFile, JSON.stringify({ ...state, historyEntry: true }, null, 1))
			this.pushUiState(true)
		} catch {}
	}

	/** Every closed session gets its history row even if it closed while no window was tracking —
	 *  and, once, the sessions closed before rows existed at all. Called at activation. */
	sweepClosedSessionsIntoHistory(): void {
		try {
			for (const e of fs.readdirSync(HANDOVER_ROOT, { withFileTypes: true })) {
				if (e.isDirectory()) {
					this.ensureSessionInHistory(e.name)
				}
			}
		} catch {}
	}

	/** Keep a durable, human-readable record of a handed-over session next to the handover, so a returned
	 *  session is not lost the moment the live view unmounts. The operator reported exactly that: "I lost
	 *  the past external agent conversation." Written on return; opened by the worklog command. */
	private writeSessionRecord(id: string): void {
		try {
			const doc = this.renderWorklog(id)
			fs.writeFileSync(path.join(HANDOVER_ROOT, id, "worklog.md"), doc)
		} catch {}
	}

	// ── the worklog view: the card-menu rendering of the handed-away session ─
	async showWorklog(id?: string): Promise<void> {
		const hid = id ?? this.activeId ?? this.newestHandoverId()
		if (!hid) {
			vscode.window.showInformationMessage("Adsum: no handed-over session to show.")
			return
		}
		const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: this.renderWorklog(hid) })
		await vscode.window.showTextDocument(doc, { preview: true })
	}

	/** The worklog document for a handover — pure string building over the on-disk record. */
	private renderWorklog(id?: string): string {
		const hid = id ?? this.activeId ?? this.newestHandoverId()
		if (!hid) {
			return "# No handed-over session on this machine"
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
		return lines.join("\n")
	}

	/** The provider that ran work before this handover, if we recorded one. */
	private providerBeforeHandover(): string | undefined {
		return this.context.globalState.get<string>("adsum.providerBeforeHandover")
	}

	/** Restore inference so a returned session can actually run here. Returns false when nothing usable
	 *  is configured — the caller must say so rather than starting a task that cannot call a model. */
	async restoreProviderForReturn(): Promise<boolean> {
		try {
			const sm = StateManager.get()
			const cfg = sm.getApiConfiguration() as any
			const current = cfg.actModeApiProvider ?? cfg.planModeApiProvider
			if (current !== "external-agent") {
				return true // already on something that can run
			}
			const prev = this.providerBeforeHandover()
			if (!prev) {
				return false
			}
			sm.setApiConfiguration({ ...cfg, planModeApiProvider: prev, actModeApiProvider: prev })
			await this.refreshConductorCache()
			return true
		} catch {
			return false
		}
	}

	/** @param resumedTaskId the Adsum task the developer is continuing in. Recorded so the agent's turns
	 *  render as THAT task's history and no other — see HandoverStrip.resumedTaskId. */
	markReturned(id: string, resumedTaskId?: string): void {
		const p = path.join(HANDOVER_ROOT, id, "state.json")
		try {
			const cur = JSON.parse(fs.readFileSync(p, "utf8"))
			fs.writeFileSync(
				p,
				JSON.stringify({ ...cur, status: "returned", returnedAt: new Date().toISOString(), resumedTaskId }, null, 1),
			)
			fs.appendFileSync(
				path.join(HANDOVER_ROOT, id, "ledger.jsonl"),
				JSON.stringify({ t: new Date().toISOString(), event: "returned" }) + "\n",
			)
			this.writeSessionRecord(id)
			// The queue is carried into the resume prompt by buildResumePrompt; clear it so a future
			// handover never delivers a message the developer already got back.
			fs.rmSync(path.join(HANDOVER_ROOT, id, "messages.jsonl"), { force: true })
		} catch {}
		this.ensureSessionInHistory(id)
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
