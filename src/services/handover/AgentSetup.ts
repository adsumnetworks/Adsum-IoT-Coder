/**
 * Installing the Adsum MCP server into the developer's own coding agent.
 *
 * The honest constraint this file is built around: we can WRITE an agent's config, but we cannot make
 * a running agent re-read it. Every agent loads MCP servers at session start. So "automatic" means
 * *the developer never edits JSON* — not *it appears in a live session*. The one manual beat that
 * remains (start a session, or restart an open one) is stated plainly rather than papered over,
 * because a silent no-op is what made the first handover look broken.
 *
 * Pure (fs + path only, no vscode) so it is testable and stays legal in services/.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export type AgentId = "claude-code" | "other"

export interface AgentSetupResult {
	/** What we did: wrote the entry, found it already correct, or could not write. */
	status: "installed" | "already" | "updated" | "unsupported" | "failed"
	/** The config file we touched (shown to the developer so nothing is mysterious). */
	configPath?: string
	/** Scope we installed at — project-local config travels with the repo. */
	scope?: "project" | "user"
	/** True when the developer must start/restart an agent session for it to load. */
	needsSessionRestart: boolean
	detail?: string
}

/**
 * Claude Code reads MCP servers from `.mcp.json` at the project root (shared, commit-able) and from
 * `~/.claude.json` (user scope). We write the PROJECT file: it is the same mechanism the handover
 * already uses, it keeps the server scoped to where the work is, and it is visible in the repo rather
 * than hidden in a home-directory blob.
 */
export function claudeCodeProjectConfig(workspace: string): string {
	return path.join(workspace, ".mcp.json")
}

/** Is the Adsum server already registered, and pointing at THIS install? */
export function readInstalledServerPath(configPath: string): string | null {
	try {
		const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"))
		const entry = cfg?.mcpServers?.adsum
		const arg = Array.isArray(entry?.args) ? entry.args[0] : undefined
		return typeof arg === "string" ? arg : null
	} catch {
		return null
	}
}

/**
 * Register the Adsum MCP server for the given agent, idempotently.
 *
 * `serverPath` must be the path inside the RUNNING extension install — a config pointing at a repo
 * working tree silently changes meaning when a branch is switched (it bit us in testing).
 */
export function installMcpServer(opts: {
	agent: AgentId
	workspace: string
	serverPath: string
	nodeBin?: string
}): AgentSetupResult {
	if (opts.agent !== "claude-code") {
		// Every MCP client has its own config location; we only claim what we have verified.
		return {
			status: "unsupported",
			needsSessionRestart: true,
			detail: "Adsum sets this up automatically for Claude Code. For another agent, add the server to its own MCP config — the exact command is shown below.",
		}
	}
	const configPath = claudeCodeProjectConfig(opts.workspace)
	const existing = readInstalledServerPath(configPath)
	if (existing === opts.serverPath) {
		return { status: "already", configPath, scope: "project", needsSessionRestart: false }
	}
	try {
		let cfg: any = {}
		try {
			cfg = JSON.parse(fs.readFileSync(configPath, "utf8"))
		} catch {}
		if (!cfg || typeof cfg !== "object") {
			cfg = {}
		}
		if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") {
			cfg.mcpServers = {}
		}
		cfg.mcpServers.adsum = { command: opts.nodeBin ?? "node", args: [opts.serverPath] }
		fs.mkdirSync(path.dirname(configPath), { recursive: true })
		fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n")
		return {
			status: existing ? "updated" : "installed",
			configPath,
			scope: "project",
			// The honest beat: a running session already loaded its servers and will not see this.
			needsSessionRestart: true,
		}
	} catch (e) {
		return { status: "failed", configPath, needsSessionRestart: true, detail: String(e) }
	}
}

/** Best-effort: has this machine got Claude Code at all? Used to offer the right default, never to gate. */
export function detectClaudeCode(vscodeExtensionPaths: string[] = []): { present: boolean; how?: string } {
	for (const p of vscodeExtensionPaths) {
		if (fs.existsSync(path.join(p, "resources", "native-binary", "claude"))) {
			return { present: true, how: "VS Code extension" }
		}
	}
	// A user-scope Claude config is strong evidence the CLI has run here.
	if (fs.existsSync(path.join(os.homedir(), ".claude.json")) || fs.existsSync(path.join(os.homedir(), ".claude"))) {
		return { present: true, how: "CLI" }
	}
	return { present: false }
}
