#!/usr/bin/env node
// clean-vscdb.js -- surgically remove every trace of Adsum IoT Coder from VS Code's
// state.vscdb SQLite stores (the global one plus each per-workspace one). This is where the
// pieces that survive an extension uninstall + globalStorage-folder delete actually live:
//   * secret://{"extensionId":"adsumnetwork.nrf-ai-debugger",...}  -> saved API keys (e.g. DeepSeek)
//   * AdsumNetwork.nrf-ai-debugger                                 -> globalState (install id, model
//                                                                     config, welcome flags, ...)
//   * workbench.view.extension.adsum-iot-coder-ActivityBar.*       -> the view container's hidden state
//   * views.customizations -> viewContainerLocations[...adsum...]  -> the moved sidebar position
//
// MUST run with VS Code fully closed: VS Code holds these DBs open and rewrites them from
// its in-memory cache on exit, which would silently undo anything changed while it runs.
//
// Resolves better-sqlite3 from the repo's node_modules, so run it with the repo's Node.
// Usage:  node scripts/clean-vscdb.js         (clean)
//         node scripts/clean-vscdb.js --dry-run

const path = require("path")
const os = require("os")
const fs = require("fs")

const DRY = process.argv.includes("--dry-run")

// better-sqlite3 lives in this repo's node_modules; resolve relative to this script.
let Database
try {
	Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"))
} catch (e) {
	console.error("Could not load better-sqlite3 from the repo node_modules. Run `npm install` first.")
	console.error(String(e))
	process.exit(1)
}

const EXT_ID = "adsumnetwork.nrf-ai-debugger" // marketplace id (secret keys, lowercased)
const GLOBAL_STATE_KEY = "AdsumNetwork.nrf-ai-debugger" // Memento key (publisher-cased)
const VIEW_CONTAINER = "workbench.view.extension.adsum-iot-coder-ActivityBar"

const userDir = path.join(os.homedir(), "AppData", "Roaming", "Code", "User")
const globalDb = path.join(userDir, "globalStorage", "state.vscdb")
const workspaceStorage = path.join(userDir, "workspaceStorage")

function cleanDb(dbPath) {
	if (!fs.existsSync(dbPath)) return
	const db = new Database(dbPath)
	let touched = 0
	const handled = new Set()
	const has = (key) => db.prepare("SELECT 1 FROM ItemTable WHERE key = ?").get(key)
	const del = (key) => {
		if (handled.has(key) || !has(key)) return
		handled.add(key)
		console.log(`  ${DRY ? "[dry] would delete" : "deleting"} row: ${key}`)
		if (!DRY) db.prepare("DELETE FROM ItemTable WHERE key = ?").run(key)
		touched++
	}

	// Exact-key rows.
	del(GLOBAL_STATE_KEY)
	del(`${VIEW_CONTAINER}.state.hidden`)
	del(`${VIEW_CONTAINER}.state`)

	// All secret rows for this extension id (openAiApiKey and any siblings).
	for (const r of db.prepare("SELECT key FROM ItemTable WHERE key LIKE 'secret://%'").all()) {
		if (r.key.toLowerCase().includes(EXT_ID)) del(r.key)
	}

	// Any other rows whose key names the extension's publisher id or view container.
	for (const r of db.prepare("SELECT key FROM ItemTable").all()) {
		const k = r.key
		if (k === GLOBAL_STATE_KEY) continue
		if (k.toLowerCase().includes(EXT_ID) || k.includes(VIEW_CONTAINER) || k.includes("adsum-iot-coder")) del(k)
	}

	// views.customizations: strip ONLY the adsum container location, keep other customizations.
	const vc = db.prepare("SELECT value FROM ItemTable WHERE key = 'views.customizations'").get()
	if (vc) {
		try {
			const raw = Buffer.isBuffer(vc.value) ? vc.value.toString("utf8") : String(vc.value)
			const obj = JSON.parse(raw)
			let changed = false
			for (const bag of ["viewContainerLocations", "viewLocations", "viewContainerBadgeEnablementStates"]) {
				if (obj[bag]) {
					for (const key of Object.keys(obj[bag])) {
						if (key.includes(VIEW_CONTAINER) || key.includes("adsum-iot-coder")) {
							console.log(`  ${DRY ? "[dry] would strip" : "stripping"} views.customizations.${bag}[${key}]`)
							delete obj[bag][key]
							changed = true
						}
					}
				}
			}
			if (changed) {
				if (!DRY) {
					db.prepare("UPDATE ItemTable SET value = ? WHERE key = 'views.customizations'").run(JSON.stringify(obj))
				}
				touched++
			}
		} catch (e) {
			console.warn(`  could not parse views.customizations (${e.message}) -- left untouched`)
		}
	}

	db.close()
	if (touched === 0) console.log(`  (nothing to clean)`)
	return touched
}

console.log(`== Cleaning global state.vscdb ==\n${globalDb}`)
cleanDb(globalDb)

if (fs.existsSync(workspaceStorage)) {
	for (const dir of fs.readdirSync(workspaceStorage)) {
		const wdb = path.join(workspaceStorage, dir, "state.vscdb")
		if (fs.existsSync(wdb)) {
			// Only announce workspace DBs that actually hold an adsum row, to keep output quiet.
			const db = new Database(wdb, { readonly: true })
			const hit = db
				.prepare("SELECT 1 FROM ItemTable WHERE key = ? OR key LIKE '%adsum%' OR key LIKE '%nrf-ai-debugger%' LIMIT 1")
				.get(GLOBAL_STATE_KEY)
			db.close()
			if (hit) {
				console.log(`\n== Cleaning workspace state.vscdb ==\n${wdb}`)
				cleanDb(wdb)
			}
		}
	}
}

console.log(`\n${DRY ? "Dry run complete -- nothing written." : "state.vscdb clean complete."}`)
