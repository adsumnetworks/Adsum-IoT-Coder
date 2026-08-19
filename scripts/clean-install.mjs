#!/usr/bin/env node
/**
 * Return this machine to a "never installed" state for Adsum IoT Coder, so a VSIX can be tested the way
 * a new user meets it — no cached knowledge, no saved tasks, no API keys, no leftover UI state.
 *
 * WHY A SCRIPT AND NOT "DELETE THE FOLDER". Deleting the extension folder and globalStorage looks
 * complete and is not. VS Code keeps extension state in a SQLite database, `state.vscdb`, and that is
 * where the install identity, the onboarding flags and the API KEYS actually live. Wipe the folders
 * only, reinstall, and the extension greets you as a returning user with your keys already filled in —
 * which is precisely the thing a fresh-install test is trying to observe.
 *
 * Everything is BACKED UP FIRST, to a folder outside the extension's reach, and the backup includes the
 * database rows as JSON so a restore can put the keys back.
 *
 *   npm run clean-install            → dry run. Lists what WOULD go. Touches nothing.
 *   npm run clean-install -- --yes   → back up, then delete.
 *   npm run clean-install -- --restore <backup-folder>
 *
 * VS CODE MUST BE CLOSED. It holds state.vscdb open, and on exit it writes its in-memory copy back —
 * which would silently restore the very rows this just deleted.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const HOME = os.homedir()
const APPDATA = process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming")
const EXT_ID = "adsumnetwork.nrf-ai-debugger"

const GLOBAL_STORAGE = path.join(APPDATA, "Code", "User", "globalStorage", EXT_ID)
const STATE_DB = path.join(APPDATA, "Code", "User", "globalStorage", "state.vscdb")
const EXT_DIR = path.join(HOME, ".vscode", "extensions")
const WORKSPACE_STORAGE = path.join(APPDATA, "Code", "User", "workspaceStorage")
const BACKUP_ROOT = path.join(HOME, "adsum-dev-backups")

/** Rows in state.vscdb that belong to this extension. The secrets are the ones folder-deletion misses. */
const DB_KEY_PATTERNS = [
	"AdsumNetwork.nrf-ai-debugger",
	`secret://{"extensionId":"${EXT_ID}"`,
	"workbench.view.extension.adsum-iot-coder-ActivityBar",
]

const args = process.argv.slice(2)
const APPLY = args.includes("--yes")
const RESTORE_AT = args.indexOf("--restore")
const RESTORE_FROM = RESTORE_AT !== -1 ? args[RESTORE_AT + 1] : null

const log = (s = "") => console.log(s)
const kb = (n) => `${Math.round(n / 1024).toLocaleString()} KB`

function dirSize(p) {
	if (!existsSync(p)) {
		return 0
	}
	if (!statSync(p).isDirectory()) {
		return statSync(p).size
	}
	let total = 0
	for (const e of readdirSync(p, { withFileTypes: true })) {
		total += dirSize(path.join(p, e.name))
	}
	return total
}

/** better-sqlite3 comes from this repo's node_modules, so the script must run from the repo. */
function openDb(readonly) {
	const req = createRequire(path.join(process.cwd(), "package.json"))
	const Database = req("better-sqlite3")
	return new Database(STATE_DB, { readonly })
}

function dbRows() {
	if (!existsSync(STATE_DB)) {
		return []
	}
	try {
		const db = openDb(true)
		const all = db.prepare("SELECT key, value FROM ItemTable").all()
		db.close()
		return all.filter((r) => DB_KEY_PATTERNS.some((p) => r.key.startsWith(p)))
	} catch (e) {
		// SQLITE_BUSY / "database is locked" is the VS-Code-is-open case. Anything else is our problem,
		// and saying "is VS Code open?" for a code bug sends the developer to check the wrong thing.
		const locked = /busy|locked/i.test(e.message)
		log(`  ! could not read state.vscdb: ${e.message}`)
		log(
			locked
				? "    VS Code is holding the database. Close it completely and run again."
				: "    This is a fault in this script, not something you did. The database rows will be skipped.",
		)
		return []
	}
}

// ── restore ─────────────────────────────────────────────────────────────────────

if (RESTORE_FROM) {
	const src = path.resolve(RESTORE_FROM)
	if (!existsSync(src)) {
		log(`No backup at ${src}`)
		process.exit(1)
	}
	log(`Restoring from ${src}`)
	const storage = path.join(src, "globalStorage")
	if (existsSync(storage)) {
		mkdirSync(GLOBAL_STORAGE, { recursive: true })
		cpSync(storage, GLOBAL_STORAGE, { recursive: true })
		log(`  restored globalStorage → ${GLOBAL_STORAGE}`)
	}
	const rowsFile = path.join(src, "state-rows.json")
	if (existsSync(rowsFile)) {
		const rows = JSON.parse(readFileSync(rowsFile, "utf8"))
		const db = openDb(false)
		const stmt = db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
		for (const r of rows) {
			stmt.run(r.key, r.value)
		}
		db.close()
		log(`  restored ${rows.length} state.vscdb row(s), including API keys`)
	}
	log("\nDone. Start VS Code.")
	process.exit(0)
}

// ── survey ──────────────────────────────────────────────────────────────────────

log("Adsum IoT Coder — clean install")
log(APPLY ? "MODE: APPLY (things will be deleted)" : "MODE: dry run (nothing will be touched)")
log()

const installed = existsSync(EXT_DIR)
	? readdirSync(EXT_DIR, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name.startsWith(EXT_ID))
			.map((e) => path.join(EXT_DIR, e.name))
	: []

const wsEntries = existsSync(WORKSPACE_STORAGE)
	? readdirSync(WORKSPACE_STORAGE, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => path.join(WORKSPACE_STORAGE, e.name, EXT_ID))
			.filter(existsSync)
	: []

const rows = dbRows()

log("WILL BE REMOVED")
log("─".repeat(70))
for (const p of installed) {
	log(`  extension    ${path.basename(p)}  (${kb(dirSize(p))})`)
}
if (existsSync(GLOBAL_STORAGE)) {
	for (const e of readdirSync(GLOBAL_STORAGE, { withFileTypes: true })) {
		const p = path.join(GLOBAL_STORAGE, e.name)
		const note = e.name === "tasks" ? "  ← your conversations" : e.name === "iot-memory" ? "  ← project memory" : ""
		log(`  storage      ${e.name.padEnd(14)} ${kb(dirSize(p)).padStart(12)}${note}`)
	}
}
for (const p of wsEntries) {
	log(`  workspace    ${path.basename(path.dirname(p))}`)
}
for (const r of rows) {
	const secret = r.key.startsWith("secret://")
	const label = secret ? `API KEY  ${r.key.replace(/.*"key":"([^"]+)".*/, "$1")}` : r.key
	log(`  database     ${label}`)
}
if (rows.some((r) => r.key.startsWith("secret://"))) {
	log()
	log("  NOTE: your API keys are among these. They are backed up and can be restored,")
	log("        but a fresh install will start with no keys — which is the point.")
}

log()
log(`Backup goes to  ${BACKUP_ROOT}`)
log()

if (!APPLY) {
	log("Dry run only. Nothing was touched.")
	log("To do it for real:")
	log("  1. CLOSE VS CODE COMPLETELY (it holds state.vscdb and rewrites it on exit)")
	log("  2. npm run clean-install -- --yes")
	process.exit(0)
}

// ── back up, then delete ────────────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const backup = path.join(BACKUP_ROOT, stamp)
mkdirSync(backup, { recursive: true })

if (existsSync(GLOBAL_STORAGE)) {
	cpSync(GLOBAL_STORAGE, path.join(backup, "globalStorage"), { recursive: true })
	log(`backed up globalStorage  → ${path.join(backup, "globalStorage")}`)
}
writeFileSync(path.join(backup, "state-rows.json"), JSON.stringify(rows, null, 2))
log(`backed up ${rows.length} database row(s) → state-rows.json  (includes API keys)`)
writeFileSync(
	path.join(backup, "RESTORE.txt"),
	`Restore everything in this folder with:\n\n` +
		`  cd ${process.cwd()}\n` +
		`  npm run clean-install -- --restore "${backup}"\n\n` +
		`Close VS Code first.\n`,
)

log()
for (const p of installed) {
	rmSync(p, { recursive: true, force: true })
	log(`removed  ${path.basename(p)}`)
}
if (existsSync(GLOBAL_STORAGE)) {
	rmSync(GLOBAL_STORAGE, { recursive: true, force: true })
	log(`removed  globalStorage`)
}
for (const p of wsEntries) {
	rmSync(p, { recursive: true, force: true })
	log(`removed  workspaceStorage entry`)
}
if (rows.length > 0) {
	try {
		const db = openDb(false)
		const del = db.prepare("DELETE FROM ItemTable WHERE key = ?")
		for (const r of rows) {
			del.run(r.key)
		}
		db.close()
		log(`removed  ${rows.length} database row(s), API keys included`)
	} catch (e) {
		log(`! could not write state.vscdb: ${e.message}`)
		log("  VS Code is probably still open. Close it and run again, or the keys will survive.")
		process.exit(1)
	}
}

log()
log("This machine now looks like Adsum IoT Coder was never installed.")
log(`Backup: ${backup}`)
log()
log("Next: open VS Code, install the VSIX, and you will get the true first-run experience.")
