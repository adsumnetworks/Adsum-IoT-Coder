import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { devicesFromProbe, envFromDetectors, isCurrentlyPresent, mergeDevices } from "./hostFacts"
import { buildWorkspaceMap } from "./mapBuilder"
import { isAlwaysIncluded, MAP_CAP_CHARS, renderMap } from "./mapDrop"
import { PROJECT_MD_CAP, renderFreshness, renderProjectMd, renderTailBlock, TAIL_BLOCK_CAP } from "./render"
import { emptyDevices, emptySession, emptyStatus, parseSession, parseStatus } from "./schema"

/**
 * Workspace project memory — the pieces that must be right for memory to survive a compaction
 * and stop the agent re-deriving what it already knew.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/memory/workspace/memory.test.ts
 */

// ── device probe parsing (real bench output) ─────────────────────────────────────

// Verbatim from `nrfutil device list` on the dev bench: an nRF52840 DK and an ESP32 CP2102 bridge.
const NRFUTIL_OUTPUT = [
	"1",
	"Product         CP2102 USB to UART Bridge Controller",
	"Ports           COM10",
	"Traits          serialPorts, usb",
	"",
	"683335182",
	"Product         J-Link",
	"Board version   PCA10056",
	"Ports           COM9",
	"Traits          devkit, jlink, seggerUsb, serialPorts, usb",
	"",
	"Found 2 supported devices",
	"",
].join("\r\n") // CRLF on purpose — this is Windows

describe("devicesFromProbe — real nrfutil output", () => {
	test("parses the DK and the USB-serial bridge", () => {
		const d = devicesFromProbe(NRFUTIL_OUTPUT)
		assert.equal(d.length, 2, "two devices")

		const dk = d.find((x) => x.id === "683335182")
		assert.ok(dk, "DK found by serial")
		assert.equal(dk?.kind, "jlink")
		assert.equal(dk?.board, "PCA10056")
		assert.equal(dk?.port, "COM9")
		assert.equal(dk?.description, "J-Link")

		const esp = d.find((x) => x.id === "1")
		assert.equal(esp?.kind, "usb-serial")
		assert.equal(esp?.port, "COM10")
	})

	test("tolerates junk: empty input, trailer only, unknown fields", () => {
		assert.deepEqual(devicesFromProbe(""), [])
		assert.deepEqual(devicesFromProbe("Found 0 supported devices"), [])
		assert.doesNotThrow(() => devicesFromProbe("683335182\nWobble   xyz\nPorts   COM3"))
		const d = devicesFromProbe("683335182\nWobble   xyz\nPorts           COM3")
		assert.equal(d[0].port, "COM3", "known fields still parse around unknown ones")
	})
})

describe("mergeDevices — the probe must not destroy what only the developer knows", () => {
	const now = "2026-08-07T10:00:00Z"

	test("preserves developer-asserted mode and flash history", () => {
		const known = {
			schema: 1 as const,
			devices: [
				{
					id: "683335182",
					kind: "jlink" as const,
					mode: "standalone, SW6 -> nRF only",
					lastFlashedAt: "2026-08-05T17:41:00Z",
					port: "COM9",
				},
			],
		}
		const merged = mergeDevices(known, devicesFromProbe(NRFUTIL_OUTPUT), now)
		const dk = merged.devices.find((d) => d.id === "683335182")
		assert.equal(dk?.mode, "standalone, SW6 -> nRF only", "developer assertion survives the probe")
		assert.equal(dk?.lastFlashedAt, "2026-08-05T17:41:00Z", "history survives")
		assert.equal(dk?.board, "PCA10056", "probe still refreshes detected fields")
		assert.equal(dk?.lastSeenAt, now)
	})

	test("an unplugged board is retained, not deleted, and reads as not-present", () => {
		const known = {
			schema: 1 as const,
			devices: [{ id: "999999999", kind: "jlink" as const, board: "PCA10095", lastSeenAt: "2026-08-01T00:00:00Z" }],
		}
		const merged = mergeDevices(known, devicesFromProbe(NRFUTIL_OUTPUT), now)
		const gone = merged.devices.find((d) => d.id === "999999999")
		assert.ok(gone, "unplugged device kept — the agent must not re-ask about known hardware")
		assert.equal(isCurrentlyPresent(gone!, merged.probedAt), false)
		assert.equal(isCurrentlyPresent(merged.devices.find((d) => d.id === "683335182")!, merged.probedAt), true)
	})

	test("output ordering is deterministic", () => {
		const a = mergeDevices(emptyDevices(), devicesFromProbe(NRFUTIL_OUTPUT), now)
		const b = mergeDevices(emptyDevices(), devicesFromProbe(NRFUTIL_OUTPUT), now)
		assert.deepEqual(a, b)
	})
})

describe("envFromDetectors", () => {
	test("reuses detector output verbatim; no probing of its own", () => {
		const e = envFromDetectors(
			{ installedSdkVersions: ["v3.3.1", "v3.2.1"], projectSdk: { version: "v3.3.1" } },
			{ idfVersion: "v5.5.4", projectIdfVersion: "v5.5.4" },
			"2026-08-07T10:00:00Z",
		)
		assert.deepEqual(e.ncsVersions, ["v3.2.1", "v3.3.1"], "sorted for byte-stability")
		assert.equal(e.ncsProjectVersion, "v3.3.1")
		assert.equal(e.idfVersion, "v5.5.4")
	})
	test("missing detectors degrade to an empty-but-valid record", () => {
		assert.doesNotThrow(() => envFromDetectors(undefined, undefined, "2026-08-07T10:00:00Z"))
	})
})

// ── rendering ────────────────────────────────────────────────────────────────────

describe("render — determinism and caps", () => {
	const input = {
		title: "BWG840 — BLE to WiFi Gateway",
		goal: "nRF52840 scans BLE sensors, frames over UART to ESP32, which POSTs over WiFi.",
		apps: [
			{
				name: "nrf_scanner/",
				platform: "NCS",
				target: "nrf52840dk/nrf52840",
				transport: "RTT",
				buildDir: "build_nrf_scanner/",
			},
			{
				name: "esp_gateway/",
				platform: "ESP-IDF",
				target: "esp32",
				transport: "UART COM10",
				buildDir: "esp_gateway/build/",
			},
		],
		devices: [
			{ id: "683335182", description: "J-Link", board: "PCA10056", port: "COM9", kind: "jlink" as const },
			{ id: "1", description: "CP2102 bridge", port: "COM10", kind: "usb-serial" as const },
		],
		hardwareFreshness: { kind: "fresh" as const, verifiedAt: "2026-08-07T09:12:44Z" },
		assertedHardware: ["DK in standalone mode, SW6 -> nRF only"],
		toolchain: { ncsVersions: ["v3.3.1"], ncsProjectVersion: "v3.3.1", idfVersion: "v5.5.4" },
		notes: [{ file: "ble-conn-params.md", summary: "why 7.5ms interval was rejected" }],
	}

	test("byte-identical across renders (a changing prompt destroys the cache)", () => {
		assert.equal(renderProjectMd(input as never), renderProjectMd(input as never))
	})

	test("carries the goal, the board, the port and the asserted bench fact", () => {
		const md = renderProjectMd(input as never)
		assert.match(md, /BLE sensors/)
		assert.match(md, /nrf52840dk/)
		assert.match(md, /COM9/)
		assert.match(md, /SW6/)
		assert.ok(md.length <= PROJECT_MD_CAP, `within cap (${md.length})`)
	})

	test("no timestamp in the rendered body — it would invalidate the cache every turn", () => {
		const md = renderProjectMd(input as never)
		const rendered = md.match(/rendered=/g) ?? []
		assert.equal(rendered.length, 0, "no per-render timestamp in the cached prefix")
	})

	test("oversized input still respects the cap", () => {
		const fat = {
			...input,
			assertedHardware: Array.from({ length: 200 }, (_, i) => `assertion ${i} ${"x".repeat(60)}`),
			notes: Array.from({ length: 200 }, (_, i) => ({ file: `n${i}.md`, summary: "y".repeat(80) })),
		}
		const md = renderProjectMd(fat as never)
		assert.ok(md.length <= PROJECT_MD_CAP, `capped (${md.length})`)
	})

	test("empty input renders a valid minimal file rather than throwing", () => {
		assert.doesNotThrow(() => renderProjectMd({ title: "x" } as never))
	})

	test("freshness vocabulary covers all three states", () => {
		assert.match(renderFreshness({ kind: "fresh", verifiedAt: "2026-08-07T09:00:00Z" }), /fresh/)
		assert.match(renderFreshness({ kind: "stale", reason: "DK unplugged", reverifyWith: "nrfutil device list" }), /stale/)
		assert.match(renderFreshness({ kind: "unknown" }), /unknown/)
	})
})

describe("renderTailBlock — the volatile tier", () => {
	const status = {
		...emptyStatus(),
		goal: { text: "Ship the BWG840 gateway to the pilot site.", setAt: "2026-07-11T08:02:00Z", setBy: "human" as const },
		defects: [
			{
				id: "d1",
				title: "UART frames dropped after WiFi reconnect",
				state: "open" as const,
				evidence: ["logs/rtt/cap_1012.log:2211-2247", "src/gw_uart.c:214"],
				nextStep: "instrument the ring buffer high-water mark",
				updatedAt: "2026-08-06T12:00:00Z",
			},
			{
				id: "d2",
				title: "already fixed thing",
				state: "closed" as const,
				evidence: ["src/x.c:1"],
				updatedAt: "2026-08-01T00:00:00Z",
			},
		],
	}
	const session = {
		...emptySession(),
		focus: "reproducing the drop with a 30s capture",
		loop: [{ at: "2026-08-06T12:01:00Z", kind: "capture" as const, detail: "30s RTT on 683335182", ok: true }],
		lastError: { at: "2026-08-06T12:02:00Z", text: "ring overrun, dropped 37" },
	}

	test("recites the goal and the open defect with its evidence paths", () => {
		const t = renderTailBlock(status, session)
		assert.match(t, /pilot site/, "goal recited near the end of context")
		assert.match(t, /UART frames dropped/)
		assert.match(t, /cap_1012\.log:2211-2247/, "log PATH and LINE RANGE, never the log body")
		assert.match(t, /ring overrun/)
	})

	test("excludes closed defects and stays within cap", () => {
		const t = renderTailBlock(status, session)
		assert.ok(!t.includes("already fixed thing"), "closed defects dropped")
		assert.ok(t.length <= TAIL_BLOCK_CAP, `within cap (${t.length})`)
	})

	test("survives empty state without throwing", () => {
		assert.doesNotThrow(() => renderTailBlock(emptyStatus(), emptySession()))
	})
})

// ── schema parsing is defensive ──────────────────────────────────────────────────

describe("schema parsers never throw on bad input", () => {
	test("corrupt or hand-edited JSON degrades to empty", () => {
		assert.deepEqual(parseStatus("{not json"), emptyStatus())
		assert.deepEqual(parseSession("[]"), emptySession())
		assert.deepEqual(parseStatus('{"defects":"nope"}').defects, [])
	})
	test("unknown defect state falls back to open rather than being dropped", () => {
		const s = parseStatus('{"defects":[{"id":"a","title":"t","state":"wat","evidence":[]}]}')
		assert.equal(s.defects[0].state, "open")
	})
})

// ── workspace map ────────────────────────────────────────────────────────────────

function makeFixtureTree(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-map-"))
	const w = (rel: string, body = "x") => {
		const p = path.join(root, rel)
		fs.mkdirSync(path.dirname(p), { recursive: true })
		fs.writeFileSync(p, body)
	}
	w("nrf_scanner/src/main.c")
	w("nrf_scanner/src/scanner.c")
	w("nrf_scanner/prj.conf")
	w("nrf_scanner/CMakeLists.txt")
	w("nrf_scanner/boards/nrf52840dk_nrf52840.overlay")
	// build output must be excluded — a literal "build" match misses this one, which is how a
	// real gateway repo went from 46 mapped files to 251.
	w("nrf_scanner/build_nrf_scanner/zephyr/.config", "y".repeat(500))
	w("nrf_scanner/build_nrf_scanner/CMakeCache.txt")
	w("esp_gateway/main/app_main.c")
	w("esp_gateway/main/CMakeLists.txt")
	w("esp_gateway/sdkconfig.defaults")
	w("esp_gateway/build/junk.bin")
	w("shared/gw_proto.h")
	w("logs/rtt/big.log", "z".repeat(5000))
	w(".adsum/PROJECT.md")
	w("README.md")
	// Debris found on the real gateway repo — all must be excluded:
	w("esp_gateway/log/idf_py_stdout_output_55076", "build chatter") // singular `log` dir
	w("esp_gateway/secure_boot_signing_key.pem", "KEY") // key material
	w("esp_gateway/nvs_erase.bin", " ") // binary
	w("esp", "28KB of mistyped shell redirect") // extensionless junk
	w("esp_gateway/c", "junk")
	w("esp_gateway/Kconfig", "config Foo") // extensionless but MEANINGFUL
	return root
}

describe("buildWorkspaceMap", () => {
	test("excludes build*, logs and .adsum; keeps the contract header", async () => {
		const root = makeFixtureTree()
		try {
			const map = await buildWorkspaceMap(root)
			const paths = map.map((e) => e.path)
			assert.ok(
				!paths.some((p) => p.includes("build_nrf_scanner")),
				`build_nrf_scanner excluded (regression: got ${paths.filter((p) => p.includes("build")).join(",")})`,
			)
			assert.ok(!paths.some((p) => p.startsWith("esp_gateway/build/")), "esp build excluded")
			assert.ok(!paths.some((p) => p.startsWith("logs/")), "logs excluded")
			assert.ok(!paths.some((p) => p.startsWith(".adsum")), "memory dir excluded")
			assert.ok(paths.includes("shared/gw_proto.h"), "cross-chip contract header present")
			assert.ok(paths.includes("nrf_scanner/prj.conf"))
			assert.ok(
				paths.every((p) => !p.includes("\\")),
				"forward slashes only",
			)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("excludes real-world debris: log/ dir, key material, binaries, mistyped-redirect files", async () => {
		const root = makeFixtureTree()
		try {
			const paths = (await buildWorkspaceMap(root)).map((e) => e.path)
			assert.ok(!paths.some((p) => p.includes("/log/")), "singular log/ dir excluded")
			assert.ok(!paths.some((p) => p.endsWith(".pem")), "key material never written into a committed map")
			assert.ok(!paths.some((p) => p.endsWith(".bin")), "binaries excluded")
			assert.ok(!paths.includes("esp"), "extensionless shell-redirect junk excluded")
			assert.ok(!paths.includes("esp_gateway/c"), "extensionless junk excluded")
			assert.ok(paths.includes("esp_gateway/Kconfig"), "meaningful extensionless files still kept")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("deterministic across runs", async () => {
		const root = makeFixtureTree()
		try {
			const a = await buildWorkspaceMap(root)
			const b = await buildWorkspaceMap(root)
			assert.deepEqual(
				a.map((e) => e.path),
				b.map((e) => e.path),
			)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("entry cap truncates and reports it honestly", async () => {
		const root = makeFixtureTree()
		try {
			const map = await buildWorkspaceMap(root, { maxEntries: 3 })
			assert.ok(map.length <= 3)
			assert.equal(map.truncation?.truncated, true, "truncation is reported, never silent")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("renderMap — drop ladder", () => {
	test("fixture map is small and mentions the key files", async () => {
		const root = makeFixtureTree()
		try {
			const map = await buildWorkspaceMap(root)
			const md = renderMap(map, MAP_CAP_CHARS, ["nrf_scanner", "esp_gateway"], map.truncation)
			assert.ok(md.length <= MAP_CAP_CHARS, `within cap (${md.length})`)
			assert.match(md, /gw_proto\.h/)
			assert.match(md, /prj\.conf/)
			assert.equal(md, renderMap(map, MAP_CAP_CHARS, ["nrf_scanner", "esp_gateway"], map.truncation))
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("under a brutal cap the allowlist still survives", () => {
		const entries = [
			...Array.from({ length: 120 }, (_, i) => ({
				path: `app/src/filler_${String(i).padStart(3, "0")}.c`,
				size: 10,
				mtimeMs: 0,
				kind: "source" as const,
			})),
			{ path: "app/prj.conf", size: 10, mtimeMs: 0, kind: "config" as const },
			{ path: "shared/gw_proto.h", size: 10, mtimeMs: 0, kind: "header" as const },
		]
		const md = renderMap(entries, 500, ["app"])
		assert.match(md, /prj\.conf/, "pinned config survives any cap")
		assert.match(md, /gw_proto\.h/, "cross-chip contract survives any cap")
	})

	test("isAlwaysIncluded pins exactly the contract-critical files", () => {
		assert.equal(isAlwaysIncluded("nrf_scanner/prj.conf"), true)
		assert.equal(isAlwaysIncluded("esp_gateway/sdkconfig.defaults"), true)
		assert.equal(isAlwaysIncluded("shared/gw_proto.h"), true)
		assert.equal(isAlwaysIncluded("nrf_scanner/boards/x.overlay"), true)
		assert.equal(isAlwaysIncluded("esp_gateway/main/app_main.c"), true)
		assert.equal(isAlwaysIncluded("nrf_scanner/src/helper.c"), false)
		assert.equal(isAlwaysIncluded("docs/notes.md"), false)
	})
})
