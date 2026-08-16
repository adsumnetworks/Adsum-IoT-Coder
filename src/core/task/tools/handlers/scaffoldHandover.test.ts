import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import {
	_resetOfferedForTest,
	isScaffoldOutsideWorkspace,
	notePendingScaffold,
	pendingScaffold,
	scaffoldHandoverMessage,
} from "./scaffoldHandover"

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

describe("the handover is the END of the scaffold task", () => {
	// Reported 2026-08-16, twice. First it fired mid-scaffold, right after CMakeLists.txt. Then, once
	// moved to the end, it was still a VS Code toast: "he show the user i will open and stay there …
	// there is no stay there he must open the folder". A toast floats outside the conversation, is
	// dismissed by accident, and lets the run continue as though nothing happened. The scaffold task
	// ends ON the button.
	const handlerSrc = fs.readFileSync(path.join(__dirname, "WriteToFileToolHandler.ts"), "utf8")
	const completionSrc = fs.readFileSync(path.join(__dirname, "AttemptCompletionHandler.ts"), "utf8")
	const buttonSrc = fs.readFileSync(
		path.join(process.cwd(), "webview-ui", "src", "components", "chat", "chat-view", "shared", "buttonConfig.ts"),
		"utf8",
	)

	test("the write handler only RECORDS — it never interrupts the run", () => {
		assert.ok(handlerSrc.includes("notePendingScaffold"))
		assert.equal(/showMessage|offerPendingScaffoldHandover/.test(handlerSrc), false)
	})

	test("the run BLOCKS on an ask, so the task genuinely stops there", () => {
		assert.ok(/config\.callbacks\.ask\("open_project"/.test(completionSrc), "must raise the blocking ask")
	})

	test("no VS Code toast anywhere in the handover", () => {
		const handover = fs.readFileSync(path.join(__dirname, "scaffoldHandover.ts"), "utf8")
		assert.equal(/showMessage|HostProvider/.test(handover), false, "the handover lives in the chat, not in a toast")
	})

	test("the button is primary, with no second option to get it wrong", () => {
		const cfg = buttonSrc.slice(buttonSrc.indexOf("open_project:"), buttonSrc.indexOf("api_req_failed:"))
		assert.ok(/primaryText: "Open project folder"/.test(cfg))
		assert.equal(/secondaryText/.test(cfg), false, "a second button would only invite the wrong choice")
		assert.ok(/sendingDisabled: false/.test(cfg), "typing stays possible — a strong default, not a trap")
	})

	test("the message states the three things the developer cannot infer", () => {
		const msg = scaffoldHandoverMessage("C:\proj\ble_relay")
		assert.ok(msg.includes("C:\proj\ble_relay"), "where the project is")
		assert.ok(/nowhere to keep its memory/.test(msg), "why opening matters")
		assert.ok(/History/.test(msg) && /reloads/.test(msg), "that the window reloads and the chat returns from History")
	})
})

describe("which folder the button opens", () => {
	test("a single app opens that app", () => {
		_resetOfferedForTest()
		const app = path.join(os.tmpdir(), "ble_relay")
		notePendingScaffold("t", app)
		assert.equal(pendingScaffold("t"), path.resolve(app))
	})

	test("a two-chip scaffold opens the CONTAINER, not one of the apps", () => {
		// Opening gw/ble-scanner would hide wifi-forwarder and break the shared memory layer that holds
		// the contract between the two chips.
		_resetOfferedForTest()
		const gw = path.join(os.tmpdir(), "gw_minew")
		notePendingScaffold("t", path.join(gw, "ble-scanner"))
		notePendingScaffold("t", path.join(gw, "wifi-forwarder"))
		assert.equal(pendingScaffold("t"), path.resolve(gw))
	})

	test("two unrelated prototypes never resolve to a personal folder", () => {
		_resetOfferedForTest()
		notePendingScaffold("t", path.join(DESKTOP, "proto-a"))
		notePendingScaffold("t", path.join(DESKTOP, "proto-b"))
		const got = pendingScaffold("t")
		assert.notEqual(got, DESKTOP, "must never offer to open the Desktop")
		assert.ok(got?.startsWith(DESKTOP), "falls back to one of the real projects")
	})

	test("two tasks do not cross wires", () => {
		_resetOfferedForTest()
		notePendingScaffold("a", path.join(os.tmpdir(), "one"))
		notePendingScaffold("b", path.join(os.tmpdir(), "two"))
		assert.ok(pendingScaffold("a")?.endsWith("one"))
		assert.ok(pendingScaffold("b")?.endsWith("two"))
	})

	test("nothing scaffolded means nothing pending", () => {
		_resetOfferedForTest()
		assert.equal(pendingScaffold("never-scaffolded"), undefined)
	})
})
