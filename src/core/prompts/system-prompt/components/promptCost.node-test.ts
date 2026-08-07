/**
 * Prompt-cost regressions — guards against paying twice for the same bytes in every request.
 *
 * Covered here:
 *  1. MCP double-injection. When native tool calling is on, `ClineToolSet.getNativeTools()`
 *     already ships every connected MCP tool's full `inputSchema` as a structured tool
 *     definition. `formatMcpServersList()` used to embed the SAME schema as prompt TEXT, so
 *     every MCP server was billed twice on every turn. Native mode must now keep the server
 *     and tool NAMES (the model still has to know what exists) and drop the schema bodies.
 *  2. XML mode must be byte-identical to the pre-change output — there the prompt text is the
 *     only place a schema is ever sent, so removing it would break tool use outright.
 *  3. The IoT-knowledge assembly memo. That block is the single biggest slice of the prompt
 *     (37–46K tokens) and was re-detected and re-read from disk every turn. It is now memoized
 *     per workspace behind a fingerprint, which must be (a) transparent — a warm read is
 *     byte-identical to a cold one — and (b) honest — every input it reads invalidates it.
 *
 * NOTE: the mocha snapshot suite does NOT cover the IoT block. `HostProvider` is never
 * initialized there, so `getIotContextSection` throws and PromptBuilder swallows it, leaving the
 * section empty in every stored snapshot. That is exactly why the memo tests below initialize a
 * real HostProvider against a temp workspace — otherwise Task A would have no regression net.
 *
 * Deliberately OUTSIDE __tests__/ so the mocha `src/**​/__tests__/*.ts` glob never picks it up.
 * Runs via `npm run test:prompt-cost` (ts-node + node:test).
 */
import assert from "node:assert/strict"
import * as fsSync from "node:fs"
import * as os from "node:os"
import * as nodePath from "node:path"
import { test } from "node:test"
import type { McpHub } from "@/services/mcp/McpHub"
import { refreshWorkspaceClassification } from "@/services/platform/WorkspaceClassifier"
import { ModelFamily } from "@/shared/prompts"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { SystemPromptSection } from "../templates/placeholders"
import type { PromptVariant, SystemPromptContext } from "../types"
import { clearIotContextCache, getIotContextSection } from "./iot_context"
import { getMcp, nativeToolDefsCarryMcpSchemas } from "./mcp"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A schema big enough that its absence/presence is unambiguous, and shaped like a real one. */
const INPUT_SCHEMA = {
	type: "object",
	properties: {
		query: { type: "string", description: "Search query to run against the component registry" },
		limit: { type: "number", description: "Maximum number of results" },
	},
	required: ["query"],
}

const SERVER = {
	uid: "1234567",
	name: "test-server",
	status: "connected",
	config: '{"command": "test"}',
	tools: [
		{ name: "test_tool", description: "A test tool", inputSchema: INPUT_SCHEMA },
		{ name: "other_tool", description: "Another test tool", inputSchema: INPUT_SCHEMA },
	],
	resources: [],
	resourceTemplates: [],
}

function makeVariant(labels: Record<string, number>): PromptVariant {
	return {
		id: "test-variant",
		version: 1,
		tags: [],
		labels,
		family: ModelFamily.GENERIC,
		description: "test",
		matcher: () => true,
		config: {},
		baseTemplate: "",
		componentOrder: [SystemPromptSection.MCP],
		componentOverrides: {},
		placeholders: {},
	}
}

const NATIVE_VARIANT = makeVariant({ use_native_tools: 1 })
const XML_VARIANT = makeVariant({})

function makeContext(enableNativeToolCalls: boolean): SystemPromptContext {
	return {
		cwd: "/test/project",
		ide: "TestIde",
		isTesting: true,
		providerInfo: { providerId: "test", model: { id: "fast", info: { supportsPromptCache: false } }, mode: "act" } as never,
		enableNativeToolCalls,
		mcpHub: { getServers: () => [SERVER] } as unknown as McpHub,
	}
}

const SCHEMA_MARKERS = ["Input Schema:", '"properties"', "Search query to run against the component registry"]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("native mode: the MCP text section names the servers and tools but omits the JSON schemas", async () => {
	const text = await getMcp(NATIVE_VARIANT, makeContext(true))
	assert.ok(text, "MCP section should still be emitted in native mode")

	// The model must still learn that these exist and what they are for.
	assert.match(text, /## test-server/, "server name must survive")
	assert.match(text, /### Available Tools/, "tool list heading must survive")
	assert.match(text, /- test_tool: A test tool/, "tool name + description must survive")
	assert.match(text, /- other_tool: Another test tool/, "every tool must survive, not just the first")
	assert.match(text, /use_mcp_tool/, "the how-to-call instruction must survive")

	// …but the schema bodies are the native tool definitions' job now.
	for (const marker of SCHEMA_MARKERS) {
		assert.ok(!text.includes(marker), `native-mode MCP text must not contain the schema marker ${JSON.stringify(marker)}`)
	}
	assert.ok(!text.includes("inputSchema"), "native-mode MCP text must not contain a serialized inputSchema")
})

test("XML mode: the MCP text section is byte-identical to the pre-change output (schemas are the only copy)", async () => {
	const text = await getMcp(XML_VARIANT, makeContext(false))
	assert.ok(text, "MCP section should be emitted in XML mode")

	// Reproduce the original formatting exactly, independently of the implementation.
	const schemaBlock = `    Input Schema:\n    ${JSON.stringify(INPUT_SCHEMA, null, 2).split("\n").join("\n    ")}`
	const expected =
		`MCP SERVERS\n\n` +
		`The Model Context Protocol (MCP) enables communication between the system and locally running MCP servers that provide additional tools and resources to extend your capabilities.\n\n` +
		`# Connected MCP Servers\n\n` +
		`When a server is connected, you can use the server's tools via the \`use_mcp_tool\` tool, and access the server's resources via the \`access_mcp_resource\` tool.\n\n` +
		`## test-server (\`test\`)\n\n### Available Tools\n` +
		`- test_tool: A test tool\n${schemaBlock}\n\n` +
		`- other_tool: Another test tool\n${schemaBlock}`

	assert.equal(text, expected)
})

test("the native gate needs BOTH the variant label and the user setting — it mirrors ClineToolSet.getNativeTools", async () => {
	// Setting on, variant does not advertise native tools → no native defs are produced, so the
	// text section is the only carrier and must keep the schemas.
	assert.equal(nativeToolDefsCarryMcpSchemas(XML_VARIANT, makeContext(true)), false)
	assert.match((await getMcp(XML_VARIANT, makeContext(true)))!, /Input Schema:/)

	// Variant advertises native tools, setting off → same, schemas must stay.
	assert.equal(nativeToolDefsCarryMcpSchemas(NATIVE_VARIANT, makeContext(false)), false)
	assert.match((await getMcp(NATIVE_VARIANT, makeContext(false)))!, /Input Schema:/)

	// Both on → the native defs carry them.
	assert.equal(nativeToolDefsCarryMcpSchemas(NATIVE_VARIANT, makeContext(true)), true)
})

test("dropping the schemas is where the savings are: native mode is materially smaller", async () => {
	const nativeText = (await getMcp(NATIVE_VARIANT, makeContext(true)))!
	const xmlText = (await getMcp(XML_VARIANT, makeContext(false)))!
	assert.ok(
		nativeText.length * 2 < xmlText.length,
		`expected native-mode MCP text to be far smaller; got ${nativeText.length} vs ${xmlText.length} chars`,
	)
})

test("a disconnected server is still excluded in both modes", async () => {
	const disconnected = { ...SERVER, status: "disconnected" }
	const ctx = (native: boolean): SystemPromptContext => ({
		...makeContext(native),
		mcpHub: { getServers: () => [disconnected] } as unknown as McpHub,
	})
	for (const [variant, native] of [
		[NATIVE_VARIANT, true],
		[XML_VARIANT, false],
	] as const) {
		const text = (await getMcp(variant, ctx(native)))!
		assert.ok(!text.includes("test_tool"), "a disconnected server must not be described at all")
	}
})

// ---------------------------------------------------------------------------
// IoT-knowledge assembly memo (Task A)
// ---------------------------------------------------------------------------

const REPO_ROOT = nodePath.resolve(__dirname, "../../../../..")

/** A minimal but REAL nRF workspace on disk, plus a HostProvider pointed at the real
 *  `iot-knowledge/` corpus, so the assembly does actual detection and actual file reads. */
function makeWorkspace(): { cwd: string; storage: string } {
	const root = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), "iotmemo-"))
	const cwd = nodePath.join(root, "app")
	fsSync.mkdirSync(nodePath.join(cwd, "build"), { recursive: true })
	fsSync.writeFileSync(nodePath.join(cwd, "prj.conf"), "CONFIG_BT=y\nCONFIG_LOG=y\n")
	fsSync.writeFileSync(nodePath.join(cwd, "CMakeLists.txt"), "find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\n")
	// nRF54 targets on purpose: they have no curated board bit, so the assembly never reaches the
	// registry and the test stays hermetic. (Board bits are all downloaded/proprietary — none ship
	// in the repo — so a bundled-board fixture would make this test do a network round-trip.)
	fsSync.writeFileSync(nodePath.join(cwd, "build", "build_info.yml"), "board: nrf54l15dk/nrf54l15/cpuapp\n")

	const storage = nodePath.join(root, "globalstorage")
	fsSync.mkdirSync(storage, { recursive: true })

	setVscodeHostProviderMock({ extensionFsPath: REPO_ROOT, globalStorageFsPath: storage })
	refreshWorkspaceClassification([cwd])
	clearIotContextCache()
	return { cwd, storage }
}

const iotContext = (cwd: string): SystemPromptContext => ({ ...makeContext(false), cwd })

async function iotBlock(cwd: string): Promise<string> {
	return getIotContextSection(XML_VARIANT, iotContext(cwd))
}

test("memo: a warm read is byte-identical to a cold rebuild", async () => {
	const { cwd } = makeWorkspace()

	const cold = await iotBlock(cwd) // cold — builds and stores
	const warm = await iotBlock(cwd) // warm — must come from the memo
	assert.equal(warm, cold, "a memoized read must be byte-identical to the build it replaced")

	// And the memo must be genuinely transparent: dropping it and rebuilding yields the same bytes.
	clearIotContextCache()
	const rebuilt = await iotBlock(cwd)
	assert.equal(rebuilt, cold, "clearing the cache and rebuilding must reproduce the same block")

	// Sanity: we are actually exercising the real assembly, not an empty/failed section.
	assert.match(cold, /IoT & Embedded Context/)
	assert.match(cold, /Platform Detected: nRF Connect SDK \/ Zephyr RTOS/)
	assert.match(cold, /Protocol: BLE Detected/, "CONFIG_BT=y must pull in the BLE protocol knowledge")
	assert.ok(cold.length > 5000, `expected a substantial knowledge block, got ${cold.length} chars`)
})

test("memo: editing prj.conf invalidates it (no stale knowledge for the rest of the session)", async () => {
	const { cwd } = makeWorkspace()

	const withBle = await iotBlock(cwd)
	assert.match(withBle, /Protocol: BLE Detected/)

	// Drop BLE. Same cwd, no explicit cache clear — the fingerprint alone must catch this.
	fsSync.writeFileSync(nodePath.join(cwd, "prj.conf"), "CONFIG_LOG=y\n")
	const withoutBle = await iotBlock(cwd)
	assert.ok(!withoutBle.includes("Protocol: BLE Detected"), "a prj.conf edit must invalidate the memoized block")
	assert.match(withoutBle, /Platform Detected: nRF Connect SDK \/ Zephyr RTOS/, "the rest of the block must still build")
})

test("memo: a new build folder invalidates it (board knowledge follows build_info.yml)", async () => {
	const { cwd } = makeWorkspace()

	const before = await iotBlock(cwd)
	assert.ok(!before.includes("build_5340"), "precondition: the second build dir does not exist yet")

	fsSync.mkdirSync(nodePath.join(cwd, "build_5340"), { recursive: true })
	fsSync.writeFileSync(nodePath.join(cwd, "build_5340", "build_info.yml"), "board: nrf54h20dk/nrf54h20/cpuapp\n")

	const after = await iotBlock(cwd)
	assert.match(after, /build_5340\/ → board: nrf54h20dk\/nrf54h20\/cpuapp/, "a new build descriptor must invalidate the memo")
})

// THE TIER A / TIER B INVARIANT.
//
// This assertion is INVERTED from Wave 2, deliberately. It used to require that a memory write
// invalidate the memoized prompt block -- correct while ALL memory lived in the system prompt.
//
// It is now the opposite requirement. Volatile memory (open defects, current focus, last error)
// lives in .adsum/status.json + .adsum/local/session.json and is rendered onto the LAST USER
// MESSAGE each turn, downstream of the prompt cache breakpoint. If a defect write changed the
// system prompt, every write would force the provider to re-process ~46K tokens of cached prefix
// -- exactly the cost this split exists to avoid.
//
// Stable memory (PROJECT.md, MAP.md) IS in the fingerprint and DOES invalidate, which is correct:
// it only changes when the workspace itself changes.
test("memo: a VOLATILE memory write must NOT invalidate the system prompt", async () => {
	const { cwd } = makeWorkspace()

	const before = await iotBlock(cwd)

	const adsumLocal = nodePath.join(cwd, ".adsum", "local")
	fsSync.mkdirSync(adsumLocal, { recursive: true })
	fsSync.writeFileSync(
		nodePath.join(cwd, ".adsum", "status.json"),
		JSON.stringify({
			schema: 1,
			defects: [
				{
					id: "d1",
					title: "RTT capture is dropping frames above 1 Mbps",
					state: "open",
					evidence: ["logs/rtt/cap.log:100-120"],
					updatedAt: "2026-08-07T00:00:00Z",
				},
			],
		}),
	)
	fsSync.writeFileSync(
		nodePath.join(adsumLocal, "session.json"),
		JSON.stringify({ schema: 1, focus: "chasing the drop", loop: [] }),
	)

	const after = await iotBlock(cwd)
	assert.equal(after, before, "a defect/session write must leave the cached system prompt byte-identical")
	assert.ok(!after.includes("RTT capture is dropping frames"), "volatile state must never leak into Tier A")
})

test("memo: a STABLE memory write (PROJECT.md) DOES invalidate", async () => {
	const { cwd } = makeWorkspace()

	const before = await iotBlock(cwd)
	assert.ok(!before.includes("BWG840 gateway"), "precondition: no project memory yet")

	fsSync.mkdirSync(nodePath.join(cwd, ".adsum"), { recursive: true })
	fsSync.writeFileSync(
		nodePath.join(cwd, ".adsum", "PROJECT.md"),
		["<!-- adsum:project schema=1 -->", "# BWG840 gateway", ""].join("\n"),
	)

	const after = await iotBlock(cwd)
	assert.match(after, /BWG840 gateway/, "a PROJECT.md write must invalidate the memo and reach the prompt")
})

test("memo: workspaces are cached independently (no cross-workspace bleed)", async () => {
	const a = makeWorkspace()
	// A second workspace, deliberately NOT an nRF project.
	const bRoot = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), "iotmemo-b-"))
	fsSync.writeFileSync(nodePath.join(bRoot, "README.md"), "not a firmware project\n")

	const blockA = await iotBlock(a.cwd)
	const blockB = await iotBlock(bRoot)
	const blockAAgain = await iotBlock(a.cwd)

	assert.match(blockA, /Platform Detected: nRF Connect SDK \/ Zephyr RTOS/)
	assert.ok(!blockB.includes("Platform Detected: nRF Connect SDK"), "workspace B must not inherit workspace A's platform")
	assert.equal(blockAAgain, blockA, "interleaving another workspace must not corrupt A's entry")
})
