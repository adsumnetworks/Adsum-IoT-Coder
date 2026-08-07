import * as crypto from "crypto"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Where workspace project memory lives.
 *
 * The predecessor stored memory under `globalStorage/iot-memory/<md5(cwd)>/`, which had three
 * defects proven in the field: it orphaned itself when the developer moved the project folder
 * (a real gateway project moved Desktop/ -> Desktop/archives/ and lost its memory), it was
 * invisible in the file tree so nobody could inspect or correct it, and it could not be
 * committed or shared with a teammate.
 *
 * Memory now lives in the workspace at `.adsum/`, split into two zones:
 *   - shared (committed): facts true for everyone working on this project
 *   - local/ (gitignored): facts true only for THIS bench — serial numbers, COM ports,
 *     toolchain install paths. Committing those guarantees a merge conflict on a teammate's
 *     first push and makes the file lie for every other machine.
 */

export const ADSUM_DIR = ".adsum"

export interface AdsumPaths {
	/** The `.adsum` directory itself. */
	dir: string
	/** Always injected into the system prompt. Host-rendered, committed. */
	projectMd: string
	/** Workspace file map. Host-generated, committed, conditionally injected. */
	mapMd: string
	/** Goals + defect ledger. Machine-checkable, committed, rendered into the tail block. */
	statusJson: string
	/** Model-written topic files. Never injected; referenced by path from PROJECT.md. */
	notesDir: string
	/** Per-bench facts — gitignored. */
	localDir: string
	devicesJson: string
	envJson: string
	sessionJson: string
	/** Generated once; contains exactly `local/`. */
	gitignore: string
	/** One-shot migration sentinel. */
	migratedSentinel: string
}

/**
 * Resolve the memory paths for a workspace root.
 *
 * `cwd` empty/undefined means no folder is open (a scratch chat). There is no workspace to
 * write into, so we fall back to the legacy globalStorage location keyed by a stable hash —
 * memory still works, it just cannot be committed. This is the ONLY remaining use of the
 * md5-keyed layout.
 */
export function resolveAdsumPaths(cwd: string | undefined): AdsumPaths {
	const dir = cwd ? path.join(cwd, ADSUM_DIR) : legacyGlobalStorageDir(cwd ?? "")
	return pathsUnder(dir)
}

export function pathsUnder(dir: string): AdsumPaths {
	const localDir = path.join(dir, "local")
	return {
		dir,
		projectMd: path.join(dir, "PROJECT.md"),
		mapMd: path.join(dir, "MAP.md"),
		statusJson: path.join(dir, "status.json"),
		notesDir: path.join(dir, "notes"),
		localDir,
		devicesJson: path.join(localDir, "devices.json"),
		envJson: path.join(localDir, "env.json"),
		sessionJson: path.join(localDir, "session.json"),
		gitignore: path.join(dir, ".gitignore"),
		migratedSentinel: path.join(dir, ".migrated"),
	}
}

/** The pre-`.adsum` store, kept only for migration and the no-folder-open case. */
export function legacyGlobalStorageDir(cwd: string): string {
	const hash = crypto.createHash("md5").update(cwd).digest("hex")
	return path.join(HostProvider.get().globalStorageFsPath, "iot-memory", hash)
}

/** True when this path is inside a `.adsum` directory (used to keep memory out of the file map). */
export function isAdsumPath(p: string): boolean {
	const norm = p.replace(/\\/g, "/")
	return norm.includes(`/${ADSUM_DIR}/`) || norm.endsWith(`/${ADSUM_DIR}`)
}
