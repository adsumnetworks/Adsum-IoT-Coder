export type Tenure = "new" | "dormant" | "returning"

/**
 * Pure tenure classifier.
 * - new: no tasks ever (the real first run).
 * - dormant: has tasks but is re-engaging (showAnnouncement = new version).
 * - returning: active user, no nudge needed.
 * "new" wins over showAnnouncement — a user who installed but never ran a task is new, not dormant.
 */
export function getTenure(p: { taskCount: number; showAnnouncement: boolean }): Tenure {
	if (p.taskCount === 0) {
		return "new"
	}
	if (p.showAnnouncement) {
		return "dormant"
	}
	return "returning"
}

export type IntentId =
	| "demo"
	| "prototype"
	| "openProject"
	| "addFeature"
	| "debug"
	| "buildFlash"
	| "buildFlashDebug"
	| "testValidate"
	| "craCheck"
	| "sdkMigration"
	| "boardBringUp"
	| "cellularGateway"
	| "blg20Gateway"
	| "ntnBringUp"
	| "nrf91BringUp"
	| "edgeAi"

export interface IntentDef {
	id: IntentId
	icon: string
	title: string
	description: string
	/** Cyan "hero" treatment + the lead card. */
	primary?: boolean
	/** Small pill shown next to the title (e.g. "Start here"). */
	pill?: string
	/** What this run needs BEYOND a board already on the desk — its own gap, in its own words. */
	needsAlso?: string
	/** Optional one-line capability sub-line under the description (injected conditionally, e.g. A10). */
	subline?: string
	/** Roadmap card — rendered disabled under an "on the roadmap" divider, never routes. */
	comingSoon?: boolean
	/** This card maps to a curated workflow, so it can also be run by the developer's own coding agent
	 *  (Adsum conducts: knowledge, toolchain, tracking, snapshots). */
	agentRunnable?: boolean
	/** Shown under the card when it routes to the agent — a capability caveat we can state honestly
	 *  (e.g. CRA quality is model-dependent). Never a blocker; the developer decides. */
	agentCaveat?: string
	/** The entitlement group that opens this card. Absent ⇒ free to everyone, which is every card that
	 *  existed before this field did — the no-rug-pull rule holds by construction. */
	group?: string
}

/**
 * A10 — the deep-debug capability ladder shown under "Build, flash & debug" for BLE projects.
 * Protocol-neutral (no "BLE" in the label — a Wi-Fi sniffer variant lands later). HCI is the no-dongle
 * layer (lands this sprint); the radio sniffer is the additive frontier (EOS). It names the ladder — it
 * is not a promise that every layer is live today, so it degrades truthfully if the sniffer slips.
 */
export const DEEP_DEBUG_SUBLINE = "↳ deep debug — app logs → HCI → radio sniffer"

export type WorkspacePlatform = "nrf" | "esp" | "both" | "none"

/** Dev-as-hero prompt strings. projectName is interpolated where relevant. */
export function buildIntentPrompt(
	id: IntentId,
	projectName?: string,
	platform: WorkspacePlatform = "both",
	hasBle = false,
): string {
	const proj = projectName ?? "my project"
	switch (id) {
		case "prototype":
			if (platform === "esp")
				return "Start a new ESP-IDF prototype — tell me what you're building and I'll scaffold it from the right verified Espressif example."
			if (platform === "both")
				return "Start a new prototype — tell me whether it's nRF/Zephyr or ESP-IDF and what you're building, and I'll scaffold it from the right verified sample."
			return "Start a new nRF/Zephyr prototype — tell me what you're building and I'll scaffold it from the right verified Nordic sample."
		case "addFeature":
			if (platform === "esp")
				return `Add a feature to ${proj} — tell me what you need (a console command, a Wi-Fi/BLE service, NVS, etc.) and I'll wire it into your build.`
			return `Add a feature to ${proj} — tell me what you need (Zephyr shell, BLE service, NVS, etc.) and I'll wire it into your build.`
		case "debug":
			return "Stream RTT or UART logs and find the root cause — I'll add logging first if it's missing."
		case "buildFlash":
			return `Build and flash ${proj} — run the loop: build it, flash it, and bring it up.`
		case "buildFlashDebug":
			if (hasBle) {
				// BLE project → don't assume the app-log loop. Open by offering the three observability
				// layers and recommend by what's actually connected, then run the chosen one.
				return (
					`Debug ${proj} (a BLE project). Before doing anything, offer me the three ways to observe it and recommend one based on what's connected:\n` +
					`1. App logs — build, flash, and stream the RTT/UART logs (the full inner loop; add logging if it's missing).\n` +
					`2. Over-the-air sniffer — passive radio capture; I just plug in an nRF Sniffer dongle, no rebuild of my board. Tell me which port is the dongle (or detect it).\n` +
					`3. HCI host↔controller trace — needs CONFIG_BT_DEBUG_MONITOR_RTT; if it's off, enable it (rebuild + flash) first, then capture and decode.\n` +
					`Check what's ready now (enumerate serial ports for a sniffer dongle; check whether the HCI monitor is already enabled) and recommend the path needing the least setup or best matching my symptom. When I pick one, LOAD the matching curated workflow first (ble-sniffer or hci-trace) — don't answer from memory — then run it and correlate the decode with my code.`
				)
			}
			return `Build, flash and debug ${proj} — build and flash it to the board, stream the logs, and help me find any issue.`
		case "testValidate":
			if (platform === "esp")
				return `Test and validate ${proj} — host tests (the ESP-IDF "linux" target) or QEMU now, on-hardware Unity checks when a board is connected.`
			if (platform === "both")
				return `Test and validate ${proj} — host/simulator tests now, on-hardware checks when a board is connected.`
			return `Test and validate ${proj} — host tests with native_sim, on-hardware checks when boards are connected.`
		case "craCheck":
			return `Run CRA SBOM & Fix on ${proj} — pull together my SBOM from my real build, preview my secure-by-design posture against the EU Cyber Resilience Act, and surface the top gap so I can decide what to change.`
		case "cellularGateway":
			return (
				"Bring up a BLE-to-cellular gateway on a Fanstel LEW840x. " +
				"Ask me which uplink I have, then LOAD the curated gateway workflow before you answer — the " +
				"routing between the nRF52840 BLE side, the ESP32 host and the nRF9160 modem is the part I " +
				"need to get right, not a sketch of it."
			)
		case "blg20Gateway":
			return (
				"Bring up the Fanstel BLG20 gateway on its nRF9151. Ask me which uplink and which SIM I have, " +
				"then LOAD the curated BLG20 workflow before you answer — the nRF54 BLE side, the ESP32 host " +
				"and the nRF9151 modem each have their own bring-up order, and I want the one that was measured."
			)
		case "ntnBringUp":
			return (
				"Bring up NB-NTN on an nRF9151. Ask me what SIM and satellite plan I have, then LOAD the " +
				"curated NTN workflow first — attach timing, the tracking-area behaviour and what a " +
				"satellite link actually costs in power are exactly what I do not want improvised."
			)
		case "nrf91BringUp":
			return (
				"Bring up the modem on my nRF91. Ask me for my SIM, APN and network, then LOAD the curated " +
				"nRF91 attach workflow before answering — AT recipes, PSM and eDRX tuning come from the bits, " +
				"not from memory."
			)
		case "edgeAi":
			return (
				"Run a model on-device on nRF54 using the Axon NPU. Ask me what I want to infer and what " +
				"my power budget is, then LOAD the curated edge-AI workflow first."
			)
		case "demo":
			return "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]"
		case "openProject":
			return ""
		// Roadmap placeholders — never invoked (rendered disabled).
		case "sdkMigration":
		case "boardBringUp":
			return ""
	}
}

/** Card description with project-name + platform interpolation (e.g. ESP project → ESP wording). */
export function intentDescription(intent: IntentDef, projectName?: string, platform: WorkspacePlatform = "both"): string {
	const proj = projectName ?? "your project"
	if (intent.id === "addFeature") {
		if (platform === "esp") {
			return `A console command, a Wi-Fi or BLE service, NVS storage… wired into ${proj}, not a sample.`
		}
		if (platform === "both") {
			return `A shell, a BLE/Wi-Fi service, storage… wired into ${proj}, not a sample.`
		}
		return `A Zephyr shell, a BLE service, NVS storage… wired into ${proj}, not a sample.`
	}
	if (intent.id === "prototype") {
		if (platform === "esp") {
			return "Tell me what you're building — I'll scaffold from the right verified ESP-IDF example."
		}
		if (platform === "both") {
			return "Tell me what you're building (nRF/Zephyr or ESP-IDF) — I'll scaffold from the right verified sample."
		}
		return "Tell me what you're building — your prototype, scaffolded from the right verified Nordic sample, ready for you to build on."
	}
	if (intent.id === "testValidate") {
		if (platform === "esp") {
			return "Prove it works — host/QEMU Unity tests now, on-hardware checks when a board's connected."
		}
		if (platform === "both") {
			return "Prove it works — host/simulator tests now, on-hardware checks when a board's connected."
		}
		return intent.description
	}
	if (intent.id === "sdkMigration") {
		if (platform === "esp") {
			return "Bump to a newer ESP-IDF release — I surface the breaking changes and fix them with you."
		}
		if (platform === "both") {
			return "Bump to a newer nRF Connect SDK or ESP-IDF release — I surface the breaking changes and fix them with you."
		}
		return intent.description
	}
	return intent.description
}

/**
 * Decide which platform an intent card should target.
 * - An open, classified project wins (nrf / esp / both).
 * - With no project open, bias by the single installed toolchain; if BOTH or NEITHER
 *   toolchain is present, stay neutral ("both") so the agent asks which platform —
 *   never silently assume nRF (that was the prototype-always-nRF bug).
 */
export function resolveIntentPlatform(
	classification: WorkspacePlatform | undefined,
	toolchains: { nrf: boolean; esp: boolean },
): WorkspacePlatform {
	if (classification && classification !== "none") {
		return classification
	}
	if (toolchains.esp && !toolchains.nrf) {
		return "esp"
	}
	if (toolchains.nrf && !toolchains.esp) {
		return "nrf"
	}
	return "both"
}

export const NO_PROJECT_INTENTS: IntentDef[] = [
	{
		id: "prototype",
		icon: "tools",
		// Scaffolding from a description is work any agent can do, and in agent mode there is no Adsum
		// model to do it here — so it must route like the others AND say so. Unflagged, it handed over
		// silently through the generic path, with no "→ your agent" chip on the card.
		agentRunnable: true,
		title: "Start a prototype",
		description: "Tell me what you're building — I'll scaffold from the right verified sample.",
	},
	{
		id: "openProject",
		icon: "folder-opened",
		title: "Open my project",
		description:
			"Point me at your firmware folder — I'll help you build it, stream live logs while you debug, and add features to your real code.",
	},
]

/**
 * Project-open next-step cards (Omar's order mock, 2026-06-08):
 * one cyan primary (build/flash/debug — the high-frequency inner-loop + on-hardware wow),
 * then the value work, then verification — plus two greyed roadmap cards (Hick's law: 3 live choices).
 * The standalone "Build & flash" card was intentionally removed (the debug loop already builds + flashes).
 */
export const PROJECT_INTENTS: IntentDef[] = [
	{
		id: "buildFlashDebug",
		agentRunnable: true,
		icon: "zap",
		title: "Build, flash & debug",
		description: "Build, flash & stream live logs.",
		primary: true,
		pill: "Start here",
	},
	{
		id: "addFeature",
		agentRunnable: true,
		icon: "extensions",
		title: "Add a feature",
		description: "Add a Zephyr shell, a BLE service, NVS storage… to your real project, not a sample.",
	},
	{
		id: "testValidate",
		agentRunnable: true,
		icon: "beaker",
		title: "Test & validate",
		description: "Prove it works — host tests (native_sim) now, on-hardware checks when a board's connected.",
	},
	{
		id: "craCheck",
		agentRunnable: true,
		agentCaveat:
			"CRA output quality depends on the model. We benchmark this workflow on our recommended models — on a weaker one, expect a thinner SBOM and shakier posture findings, so review before you rely on it.",
		icon: "shield",
		title: "CRA SBOM & Fix",
		description:
			"From your real build: an SBOM, a secure-by-design posture preview, and a readiness check — so you decide what to fix before the EU CRA.",
	},
	{
		id: "sdkMigration",
		icon: "arrow-circle-up",
		title: "SDK Migration",
		description: "Bump to a newer nRF Connect SDK — I surface the breaking changes and fix them with you.",
		comingSoon: true,
	},
	{
		id: "boardBringUp",
		icon: "circuit-board",
		title: "Board Bring-Up",
		description: "Bring up your custom board from a DK — board files drafted and pins mapped, ready for you to verify.",
		comingSoon: true,
	},
]

/**
 * Cellular & gateways — the group behind the register gate.
 *
 * Order and copy are the approved mockup's (screen 1), verbatim. Each card names its entitlement
 * group so the lock is derived from the SAME string the bits carry — the card and the knowledge it
 * opens can never disagree about which grant unlocks them.
 *
 * Locking here is presentation, not enforcement: the registry decides what may be read. A developer
 * who edits this array sees four unlocked pictures and still gets a 402 on the first fetch.
 */
export const CELLULAR_INTENTS: IntentDef[] = [
	{
		id: "cellularGateway",
		icon: "radio-tower",
		title: "LTE-M / NB-IoT gateway",
		description: "Fanstel LEW840x: BLE in, cellular out, one code base.",
		needsAlso: "a Fanstel LEW840x and its three programming headers",
		group: "cellular-advanced",
	},
	{
		// The next-generation Fanstel gateway. Mentioned, locked, and opened per person — a
		// by-request group rather than the registered tier, because the operator unlocks it for
		// certain developers as the board's certification lands. [OPERATOR 2026-09-09]
		id: "blg20Gateway",
		icon: "circuit-board",
		// The title says what the firmware DOES. Four part numbers and two product lines in a title
		// is an order code, not an offer: at panel width it wrapped to two lines, and a developer
		// scanning the list is choosing what to build, not decoding a catalogue row. The numbers are
		// still here — one line down, where someone comparing an order code will look for them.
		title: "BLG20x gateway: BLE 6 in, Wi-Fi, cellular, satellite out",
		// Names as Fanstel writes them (fanstel.com/blg20cbwg20c, /lbg51e20c, checked 2026-09-09): the IP51
		// BLG20BC / BLG20BF / BLG20XE line and the IP67 LBG20BC / LBG20BXE / LBG20BC02C line, all nRF9151 +
		// nRF54LM20B. "BLC" was a mishearing; BWG20BF is the WiFi-only sibling with no nRF9151 and is not here.
		// One line at panel width: what it is, then the two chips. The variants and the Wi-Fi builds
		// are a detail for the board's own page, not for a row someone is scanning.
		description: "Indoor and outdoor. An nRF54 for the BLE half, an nRF9151 for cellular and satellite.",
		needsAlso: "a Fanstel BLG20x or LBG20x on the desk",
		group: "blg20-early-access",
	},
	{
		id: "ntnBringUp",
		icon: "globe",
		title: "Satellite NB-NTN bring-up",
		description: "nRF9151 over NTN: attach, timing, what a satellite link costs you.",
		needsAlso: "an nRF9151 and a SIM with a satellite plan",
		group: "cellular-advanced",
	},
	{
		id: "nrf91BringUp",
		icon: "chip",
		title: "nRF91 modem bring-up",
		description: "Attach on your SIM and APN, AT recipes, PSM and eDRX tuning.",
		needsAlso: "an nRF91-family board and a SIM",
		group: "cellular-advanced",
	},
	{
		id: "edgeAi",
		icon: "lightbulb-sparkle",
		title: "On-device inference",
		description: "nRF54 Axon NPU: models on the gateway, not in the cloud.",
		needsAlso: "an nRF54 with the Axon NPU",
		group: "edge-ai-advanced",
	},
]

/** Board names that make the cellular group relevant enough to say so above the cards. */
export const CELLULAR_BOARDS = /nrf91|9160|9151|9161|thingy:?91|lew840|blg20/i

/**
 * The one-line hint above the locked group when the developer's own hardware is already the reason
 * to register. Absent when nothing cellular is detected — a hint that names no detected thing is an
 * advertisement, and the surface's rule is that a reason earns its line only when it names something
 * real.
 */
/** Boards whose set registration alone does NOT reach: the ask is a request, not a sign-up. */
const REQUEST_ONLY_BOARDS = /blg20/i

/**
 * The one thing every not-yet-yours surface says, and the only wording for it.
 *
 * A developer should learn this phrase once. When the card pill, the sub-line under it and the row
 * in the transcript each invented their own name for the same door, the three read as three
 * different requests — and two of them ("Request access", "Request template source access") named
 * our entitlement plumbing rather than telling anyone what would happen next.
 */
export const ASK_FOR_DETAILS = "Ask for more details"

/**
 * What registering grants: the registered tier, and nothing else.
 *
 * Mirrors REGISTERED_TIER on the server (Adsum-Backend `src/services/groups.ts`); `wayIn.test.ts` compares
 * the two whenever the backend checkout sits beside this one. blg20-demo-hex left the tier on 13 Sep 2026
 * and lew840x-demo-hex on 14 Sep: both demo pairs are granted per account.
 */
export const REGISTERED_TIER_GROUPS: readonly string[] = ["cellular-advanced", "edge-ai-advanced"]

/**
 * Groups a person opens by hand, one developer at a time: every group outside the registered tier.
 *
 * Registering does not reach these and never will: they are opened after a conversation. A surface
 * that offers "Register" against one of them promises an unlock the sign-up cannot deliver — the
 * developer signs up, comes back, and the same thing is still out of reach. Every surface that can
 * show a locked thing asks this predicate, so the home screen and the transcript cannot drift into
 * telling different stories about the same group again.
 *
 * [14 Sep 2026] This was a hand-kept list of six BLG20x groups. It missed the LEW840x source and
 * production groups and the BLG20x demo pair, so a registered developer who met one of those in a task
 * was sent to "Register", which could never open it. Derived from the tier, it cannot miss one.
 */
export const isRequestOnlyGroup = (group?: string): boolean =>
	!!group && group !== "all" && !REGISTERED_TIER_GROUPS.includes(group)

/**
 * Which family's request form a group belongs to. The form is per board family, and a row in the
 * transcript knows only its group, so the mapping lives here with the groups themselves.
 */
export const requestFamilyFor = (group?: string): string => (group?.startsWith("blg20") ? "blg20" : "lew840x")

export function cellularHint(boards: readonly string[]): string | undefined {
	const match = boards.find((b) => CELLULAR_BOARDS.test(b))
	if (!match) {
		return undefined
	}
	/*
	 * "Register to unlock" has to be TRUE of the board in front of them. Registering grants the
	 * registered tier; it does not grant blg20-early-access, which a steward decides. Telling a
	 * BLG20 owner to register would send them through a sign-up that ends where it started, and a
	 * surface that promises an unlock it cannot deliver costs more than one that asks.
	 */
	return REQUEST_ONLY_BOARDS.test(match)
		? `Your ${match} is detected — ask us to unlock its attach and APN recipes.`
		: `Your ${match} is detected — register to unlock its attach and APN recipes.`
}

/**
 * What the demo-hex card runs.
 *
 * A prompt, not a direct flash call, because flashing three boards is a conversation: which ports,
 * which order, what to do when nrfutil is missing. The tool bit carries the hexes and their hashes;
 * the agent carries the developer through it and says honestly when the machine is not ready.
 */
/**
 * Installing the BLG20x pair: two images, one per half of the board, and the developer programs each
 * half with their own probe. The words the developer reads on the card are the card's; this is what
 * the run is asked to do.
 */
/**
 * What the run is asked to do for each way the developer already holds.
 *
 * One function rather than three call sites, so a way that gains an action cannot be wired to the
 * wrong prompt — and so the words a developer sees in their own composer stay in one place.
 */
export function blg20InstallPrompt(way: "demo" | "production" | "source"): string {
	if (way === "production") {
		return (
			"Install the BLG20x production image into this project. Load the curated BLG20x production tool bit " +
			"first — it carries the signed image and its hash, and I want the one you verify, not one you build. " +
			"Verify the image against its hash, show me where the files landed, and ask me which probe is which " +
			"before you program anything."
		)
	}
	if (way === "source") {
		return (
			"Set up the BLG20x firmware source in this project — the halves my account holds and no others. Load " +
			"the curated BLG20x source tool bit first, tell me plainly which halves it gave me, and show me where " +
			"the files landed before building anything."
		)
	}
	return DEMO_PAIR_PROMPT_BLG20
}

export const DEMO_PAIR_PROMPT_BLG20 =
	"Install the BLG20x demo pair into this project. Load the curated BLG20x demo-pair tool bit first — it " +
	"carries both signed images and their hashes, and I want the ones you verify, not ones you build. Then " +
	"tell me plainly what is limited about this demo before anything is written, verify each image against " +
	"its hash, and show me where the files landed. Take the serial number from the tool, never one you " +
	"remember, and ask me which probe is which before you program anything."

export const DEMO_HEX_PROMPT =
	"Flash the Fanstel LEW840x demo. LOAD the lew840x demo-hex tool bit first — it carries the demo " +
	"images and their hashes, and I want the ones you verify, not ones you build. Then walk me " +
	"through it: check nrfutil and esptool are on this machine and say plainly if they are not, ask me " +
	"which serial port is which, and flash the BLE scanner, the ESP32 uplink and the nRF9160 bearer in " +
	"that order. Tell me the cellular bearer runs in 60-minute windows that come back by themselves, " +
	"1,440 minutes in total, before I start, not after."
