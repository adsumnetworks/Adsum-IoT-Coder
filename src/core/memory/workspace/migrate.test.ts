import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { migrateLegacyMemory } from "./migrate"
import { resolveAdsumPaths } from "./paths"

/**
 * One-shot OLD (globalStorage/iot-memory/<hash>/) -> NEW (.adsum/notes/) migration.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/memory/workspace/migrate.test.ts
 *
 * `migrateLegacyMemory` takes the legacy directory as an injectable second argument specifically
 * so these tests never touch `legacyGlobalStorageDir`, which goes through `HostProvider.get()` —
 * not initialized in this plain node:test process.
 */

function makeWorkspace(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-ws-"))
	// Must look like a real project: memory is refused outside one (see projectAnchor.ts).
	fs.writeFileSync(path.join(root, "prj.conf"), "")
	return root
}

function makeLegacyDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "adsum-legacy-"))
}

// Verbatim from IotProjectMemoryManager.initialize()'s filesToInitialize — see
// src/core/memory/IotProjectMemoryManager.ts.
const placeholderProject = (cwd: string) =>
	`# Workspace: ${path.basename(cwd)}\n\n## Project Context\n\nAdd details about the application logic, dependencies, and overall architecture here.\n`
const placeholderDevices = `# Device & Hardware Profiles\n\n## Target Hardware\n\nDocument the board target (e.g., nrf52840dk), pin configurations, and external sensors here.\n`
const placeholderSession = `# Session Memory\n\n## Current Debugging State\n\nKeep track of the current problem, open issues, and findings from the latest debug loop.\n`

describe("migrateLegacyMemory", () => {
	test("missing legacy dir -> none, .adsum never created", () => {
		const cwd = makeWorkspace()
		try {
			const legacyDir = path.join(os.tmpdir(), `adsum-legacy-missing-${Date.now()}`)
			assert.equal(migrateLegacyMemory(cwd, legacyDir), "none")
			assert.equal(fs.existsSync(path.join(cwd, ".adsum")), false)
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true })
		}
	})

	test("cwd undefined -> none", () => {
		assert.equal(migrateLegacyMemory(undefined), "none")
	})

	test("placeholder-only legacy content -> none, nothing imported", () => {
		const cwd = makeWorkspace()
		const legacyDir = makeLegacyDir()
		try {
			fs.writeFileSync(path.join(legacyDir, "project.md"), placeholderProject(cwd))
			fs.writeFileSync(path.join(legacyDir, "devices.md"), placeholderDevices)
			fs.writeFileSync(path.join(legacyDir, "session.md"), placeholderSession)

			assert.equal(migrateLegacyMemory(cwd, legacyDir), "none")

			const paths = resolveAdsumPaths(cwd)
			assert.equal(fs.existsSync(paths.migratedSentinel), false, "a no-op must not burn the one-shot sentinel")
			assert.equal(fs.existsSync(path.join(paths.notesDir, "legacy-project.md")), false)
			assert.equal(fs.existsSync(path.join(paths.notesDir, "legacy-devices.md")), false)
			assert.equal(fs.existsSync(path.join(paths.notesDir, "legacy-session.md")), false)
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true })
			fs.rmSync(legacyDir, { recursive: true, force: true })
		}
	})

	test("real legacy content -> migrated; only the touched files land in .adsum/notes/", () => {
		const cwd = makeWorkspace()
		const legacyDir = makeLegacyDir()
		try {
			fs.writeFileSync(
				path.join(legacyDir, "project.md"),
				`${placeholderProject(cwd)}\nThis gateway bridges BLE to WiFi.\n`,
			)
			// devices.md is left untouched — must be skipped even though its siblings have real content.
			fs.writeFileSync(path.join(legacyDir, "devices.md"), placeholderDevices)
			fs.writeFileSync(path.join(legacyDir, "session.md"), "# Session Memory\n\nDebugging a UART overrun on COM9.\n")

			assert.equal(migrateLegacyMemory(cwd, legacyDir), "migrated")

			const paths = resolveAdsumPaths(cwd)
			assert.equal(fs.existsSync(paths.migratedSentinel), true)

			const project = fs.readFileSync(path.join(paths.notesDir, "legacy-project.md"), "utf8")
			assert.match(project, /BLE to WiFi/)
			assert.match(project, /Imported automatically/, "header explains provenance")

			assert.equal(fs.existsSync(path.join(paths.notesDir, "legacy-devices.md")), false, "untouched placeholder skipped")

			const session = fs.readFileSync(path.join(paths.notesDir, "legacy-session.md"), "utf8")
			assert.match(session, /UART overrun/)
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true })
			fs.rmSync(legacyDir, { recursive: true, force: true })
		}
	})

	test("running twice -> second call is skipped and does not re-import changed content", () => {
		const cwd = makeWorkspace()
		const legacyDir = makeLegacyDir()
		try {
			fs.writeFileSync(path.join(legacyDir, "project.md"), `${placeholderProject(cwd)}\nReal note.\n`)

			assert.equal(migrateLegacyMemory(cwd, legacyDir), "migrated")

			const paths = resolveAdsumPaths(cwd)
			const sentinelAfterFirst = fs.readFileSync(paths.migratedSentinel, "utf8")

			// Mutate the legacy file to prove a second run does not touch .adsum at all.
			fs.writeFileSync(
				path.join(legacyDir, "project.md"),
				`${placeholderProject(cwd)}\nCHANGED note that must not appear.\n`,
			)

			assert.equal(migrateLegacyMemory(cwd, legacyDir), "skipped")
			assert.equal(
				fs.readFileSync(paths.migratedSentinel, "utf8"),
				sentinelAfterFirst,
				"sentinel untouched by the second call",
			)

			const project = fs.readFileSync(path.join(paths.notesDir, "legacy-project.md"), "utf8")
			assert.match(project, /Real note/)
			assert.ok(!project.includes("CHANGED note"), "second call did not re-import")
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true })
			fs.rmSync(legacyDir, { recursive: true, force: true })
		}
	})

	test("unreadable legacy file (a directory where a file is expected) does not throw", () => {
		const cwd = makeWorkspace()
		const legacyDir = makeLegacyDir()
		try {
			// project.md is a directory, not a file -> the read throws internally (EISDIR) and must
			// be swallowed; the other, readable, non-placeholder file must still import.
			fs.mkdirSync(path.join(legacyDir, "project.md"))
			fs.writeFileSync(path.join(legacyDir, "devices.md"), "# Device & Hardware Profiles\n\nnRF52840 DK on COM9.\n")

			let result: string | undefined
			assert.doesNotThrow(() => {
				result = migrateLegacyMemory(cwd, legacyDir)
			})
			assert.equal(result, "migrated")

			const paths = resolveAdsumPaths(cwd)
			assert.equal(fs.existsSync(path.join(paths.notesDir, "legacy-project.md")), false, "unreadable file simply skipped")
			assert.match(fs.readFileSync(path.join(paths.notesDir, "legacy-devices.md"), "utf8"), /nRF52840 DK/)
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true })
			fs.rmSync(legacyDir, { recursive: true, force: true })
		}
	})

	test("legacy dir path points at a plain file (corrupt input) -> none, never throws", () => {
		const cwd = makeWorkspace()
		const legacyFileNotDir = path.join(os.tmpdir(), `adsum-legacy-file-${Date.now()}`)
		fs.writeFileSync(legacyFileNotDir, "not a directory")
		try {
			let result: string | undefined
			assert.doesNotThrow(() => {
				result = migrateLegacyMemory(cwd, legacyFileNotDir)
			})
			assert.equal(result, "none")
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true })
			fs.rmSync(legacyFileNotDir, { force: true })
		}
	})
})
