/**
 * Single-owner election for a handover's tracker.
 *
 * Why this exists: `onStartupFinished` fires in EVERY VS Code window, `~/.adsum/handovers` is global, and
 * `pickHandover` never consults the current window's workspace — so every open window arms a 3-second
 * tracker against the same handover directory. That is not theoretical: the tracker runs `git add -A` +
 * `git commit --allow-empty` per checkpoint, so N windows already produce N commits, and a window with an
 * unrelated project open commits into someone else's repo. Once a request executor rides the same tick it
 * would become N CVE scans and N lots of rate-limited NVD traffic.
 *
 * The protocol is a heartbeat file with TWO liveness gates, because neither alone is sufficient: the
 * heartbeat age catches a window that closed cleanly, and the pid check catches one that crashed and never
 * got to release. (Studio states the same rule for its own fleet rows.)
 *
 * Convergence rather than locking: two windows that both see a stale claim may both take it, but each
 * renewal re-reads the file and stands down if the pid is no longer its own — so the later writer wins and
 * the loser notices within one tick. That is sufficient here; the per-request `O_EXCL` claim is what makes
 * *execution* exclusive.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export interface HostClaim {
	pid: number
	host: string
	/** The workspace this window has open — so a stale claim is legible to a human reading the file. */
	window?: string
	startedAt: string
	heartbeatAt: string
}

/** A claim older than this with no renewal is treated as abandoned. Five tracker ticks. */
export const CLAIM_STALE_MS = 15_000

const claimPath = (root: string, id: string) => path.join(root, id, "host.json")

/** Is this pid still running? The crash gate — a clean shutdown is caught by the heartbeat instead. */
export function pidAlive(pid: number): boolean {
	if (!pid || !Number.isInteger(pid)) {
		return false
	}
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

export function readClaim(root: string, id: string): HostClaim | null {
	try {
		const raw = JSON.parse(fs.readFileSync(claimPath(root, id), "utf8"))
		return typeof raw?.pid === "number" ? (raw as HostClaim) : null
	} catch {
		return null
	}
}

/** A claim is live only if BOTH gates pass: recently renewed, and (on this host) still a running process. */
export function claimIsLive(claim: HostClaim | null, now = Date.now()): boolean {
	if (!claim) {
		return false
	}
	const age = now - Date.parse(claim.heartbeatAt)
	if (!Number.isFinite(age) || age > CLAIM_STALE_MS) {
		return false
	}
	// A pid is only meaningful on the machine that wrote it; across hosts, trust the heartbeat alone.
	return claim.host === os.hostname() ? pidAlive(claim.pid) : true
}

/**
 * Try to become the tracking owner. True if this process may run the tracker.
 * Idempotent for the current owner (renewing its own claim).
 */
export function claimOwnership(root: string, id: string, window?: string, pid = process.pid): boolean {
	const dir = path.join(root, id)
	try {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
	} catch {
		return false
	}
	const now = new Date().toISOString()
	const mine: HostClaim = { pid, host: os.hostname(), window, startedAt: now, heartbeatAt: now }
	// Fast path: nobody has ever claimed it. `wx` is atomic, so two windows racing here cannot both win.
	try {
		fs.writeFileSync(claimPath(root, id), JSON.stringify(mine), { flag: "wx" })
		return true
	} catch {
		// already exists — fall through to the liveness check
	}
	const existing = readClaim(root, id)
	if (existing && existing.pid === pid && existing.host === mine.host) {
		return renewOwnership(root, id, pid)
	}
	if (claimIsLive(existing)) {
		return false // someone else is tracking it, and they are alive
	}
	try {
		fs.writeFileSync(claimPath(root, id), JSON.stringify({ ...mine, startedAt: existing?.startedAt ?? now }))
		return true
	} catch {
		return false
	}
}

/**
 * Refresh our heartbeat. False means we are no longer the owner (another window took a claim we had let
 * go stale) — the caller must stop tracking rather than keep firing side effects.
 */
export function renewOwnership(root: string, id: string, pid = process.pid): boolean {
	const existing = readClaim(root, id)
	if (!existing || existing.pid !== pid || existing.host !== os.hostname()) {
		return false
	}
	try {
		fs.writeFileSync(claimPath(root, id), JSON.stringify({ ...existing, heartbeatAt: new Date().toISOString() }))
		return true
	} catch {
		return false
	}
}

/** Release only OUR claim — never another window's. */
export function releaseOwnership(root: string, id: string, pid = process.pid): void {
	const existing = readClaim(root, id)
	if (existing && existing.pid === pid && existing.host === os.hostname()) {
		try {
			fs.unlinkSync(claimPath(root, id))
		} catch {}
	}
}

/**
 * Does this window have the handover's own workspace open?
 *
 * Without this check a window with an unrelated project open still arms a tracker — and that tracker runs
 * `git add -A` in `brief.workspace`, i.e. commits into a repo the window never opened.
 * A missing/unknown workspace is permitted so a handover with no recorded folder is not stranded.
 */
export function windowOwnsWorkspace(briefWorkspace: string | undefined, openFolders: string[]): boolean {
	if (!briefWorkspace) {
		return true
	}
	const norm = (p: string) => path.resolve(p).replace(/[/\\]+$/, "")
	const target = norm(briefWorkspace)
	return openFolders.some((f) => {
		const root = norm(f)
		return target === root || target.startsWith(`${root}${path.sep}`) || root.startsWith(`${target}${path.sep}`)
	})
}
