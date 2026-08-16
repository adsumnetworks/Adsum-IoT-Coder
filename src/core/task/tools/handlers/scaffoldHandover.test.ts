import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { isScaffoldOutsideWorkspace } from "./scaffoldHandover"

/**
 * This decides when a dialog interrupts the developer, so the false-positive cases matter as much as
 * the true one.
 *
 * Reported 2026-08-16: a prototype scaffolds into `Desktop\ble_relay` while the workspace is still the
 * Desktop, so project memory is refused and checkpoints never initialise until the folder is opened.
 * The first version of this guard asked "is the project outside the workspace?" — which is null for
 * exactly that case, since `Desktop\ble_relay` IS inside the Desktop. The real question is whether the
 * developer has a project open at all.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/tools/handlers/scaffoldHandover.test.ts
 */

function tmpProject(name: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-"))
	const dir = path.join(root, name)
	fs.mkdirSync(dir)
	fs.writeFileSync(path.join(dir, "prj.conf"), "")
	return dir
}

const DESKTOP = path.join(os.homedir(), "Desktop")

describe("offer to open a scaffolded project — when it fires", () => {
	test("THE REPORTED CASE: project under the Desktop, with the Desktop open", () => {
		const proj = path.join(DESKTOP, `ble_relay_test_${process.pid}`)
		fs.mkdirSync(proj, { recursive: true })
		fs.writeFileSync(path.join(proj, "prj.conf"), "")
		try {
			assert.equal(isScaffoldOutsideWorkspace(path.join(proj, "prj.conf"), DESKTOP), proj)
		} finally {
			fs.rmSync(proj, { recursive: true, force: true })
		}
	})

	test("no folder open at all", () => {
		const proj = tmpProject("ble_relay")
		try {
			assert.equal(isScaffoldOutsideWorkspace(path.join(proj, "prj.conf"), undefined), proj)
		} finally {
			fs.rmSync(path.dirname(proj), { recursive: true, force: true })
		}
	})

	test("the open folder is a scratch directory that cannot hold memory", () => {
		const proj = tmpProject("app")
		try {
			// Parent has no project marker, so memory would anchor nowhere — opening the project is the fix.
			assert.equal(isScaffoldOutsideWorkspace(path.join(proj, "prj.conf"), path.dirname(proj)), proj)
		} finally {
			fs.rmSync(path.dirname(proj), { recursive: true, force: true })
		}
	})

	test("every scaffold marker counts, not just prj.conf", () => {
		for (const marker of ["CMakeLists.txt", "sdkconfig", "west.yml"]) {
			const proj = tmpProject("app")
			try {
				fs.writeFileSync(path.join(proj, marker), "")
				assert.equal(isScaffoldOutsideWorkspace(path.join(proj, marker), DESKTOP), proj, marker)
			} finally {
				fs.rmSync(path.dirname(proj), { recursive: true, force: true })
			}
		}
	})
})

describe("offer to open a scaffolded project — when it must NOT fire", () => {
	test("the project IS the open folder", () => {
		const proj = tmpProject("app")
		try {
			assert.equal(isScaffoldOutsideWorkspace(path.join(proj, "prj.conf"), proj), null)
		} finally {
			fs.rmSync(path.dirname(proj), { recursive: true, force: true })
		}
	})

	test("a monorepo app under a REAL project workspace does not interrupt", () => {
		// gw/ is itself a project, so memory already anchors per-app. Nothing is broken, and a dialog
		// every time an app is scaffolded would be pure noise.
		const gw = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
		fs.writeFileSync(path.join(gw, "CMakeLists.txt"), "")
		const app = path.join(gw, "ble-scanner")
		fs.mkdirSync(app)
		fs.writeFileSync(path.join(app, "prj.conf"), "")
		try {
			assert.equal(isScaffoldOutsideWorkspace(path.join(app, "prj.conf"), gw), null)
		} finally {
			fs.rmSync(gw, { recursive: true, force: true })
		}
	})

	test("an ordinary source file never triggers it", () => {
		const proj = tmpProject("app")
		try {
			for (const f of ["main.c", "README.md", "overlay.dts"]) {
				assert.equal(isScaffoldOutsideWorkspace(path.join(proj, f), DESKTOP), null, f)
			}
		} finally {
			fs.rmSync(path.dirname(proj), { recursive: true, force: true })
		}
	})

	test("a stray marker in a personal folder must not offer to open that folder", () => {
		assert.equal(isScaffoldOutsideWorkspace(path.join(DESKTOP, "CMakeLists.txt"), DESKTOP), null)
		assert.equal(isScaffoldOutsideWorkspace(path.join(os.homedir(), "prj.conf"), undefined), null)
	})

	test("case and separator differences do not produce a spurious offer", () => {
		const proj = tmpProject("app")
		try {
			const shouty = proj.toUpperCase().replace(/\\/g, "/")
			assert.equal(isScaffoldOutsideWorkspace(path.join(proj, "prj.conf"), shouty), null)
		} finally {
			fs.rmSync(path.dirname(proj), { recursive: true, force: true })
		}
	})
})
