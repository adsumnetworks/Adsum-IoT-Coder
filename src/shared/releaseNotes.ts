/**
 * RELEASE_NOTES: every string a user sees BECAUSE a release happened, plus the capability claims the
 * About page makes. One name, one file, one review per release.
 *
 * The surfaces that read it (nothing else may hold release copy):
 *   - the panel card a returning user sees once per announced version   (UpgradeCard.tsx)
 *   - the editor toasts at activation: update, CRA-relevant update, first install   (announcements.ts, common.ts)
 *   - the "New" badge on sample runs   (demoScenarios.ts)
 *   - Settings > About > Runs on   (AboutSection.tsx)
 *   - what is named as not offered, so the label and its switch cannot drift   (ApiOptions.tsx)
 *
 * `version` is the release these notes announce and is also the announcement id. A hotfix that changes
 * nothing a user should hear about is acknowledged in `patches` and does NOT re-toast anyone; the guard
 * test (`__tests__/releaseNotes.node-test.ts`) refuses a package.json version that is neither.
 *
 * Copy rules the guard enforces: no version numbers typed into strings (they come from `version`), no em
 * dashes, toasts under 200 characters once filled in.
 */

export const CHANGELOG_URL = "https://github.com/adsumnetworks/Adsum-IoT-Coder/blob/main/CHANGELOG.md"

export interface ReleaseLine {
	/** The thing, one word where possible. */
	head: string
	/** What the user can now do with it. */
	body: string
}

export interface RunsOnRow {
	family: string
	sdk: string
	chips: readonly string[]
	protocols: readonly string[]
	note?: string
}

export interface CardAction {
	label: string
	/** The one thing the card may start. Kept as a name so the card never carries behaviour. */
	intent: "open-gate"
}

export type PatchNote = { silent: true } | { note: string }

export const RELEASE_NOTES = {
	version: "0.4.0",

	/** Hotfixes on top of `version`. `{ silent: true }` means "nothing to announce", and no toast fires. */
	patches: {
		"0.4.1": {
			note: "the Fanstel BLG20x guided first run, the account in the panel header, and the LEW840x cellular images",
		},
	} as Record<string, PatchNote>,

	/** One line, plain words. The update toast is built from it. */
	headline:
		"the panel opens on your folder and boards · cellular and satellite with a free account · message a run while it works",

	/** The panel card. Three lines, each a thing then what to do with it. */
	card: {
		lines: [
			{
				head: "Home",
				body: "one row says what is on your desk and what is missing, then ranks the runs worth starting. Typing is the new session; every other session is in the editor's History.",
			},
			{
				head: "Account",
				body: "free, GitHub or email, no card. Unlocks gateway firmware to flash and license: the LEW840x on BLE, Ethernet, Wi-Fi and cellular; satellite NB-NTN on the nRF9151; nRF54 edge-AI basics.",
			},
			{
				head: "Runs",
				body: "send a message while the agent works and it lands at the next step. Stop is still its own button.",
			},
		] as readonly ReleaseLine[],
		/** Optional: the one click this release earns. Hidden when it no longer applies (already registered). */
		action: { label: "Register free", intent: "open-gate" } as CardAction | undefined,
		link: { label: "Full changelog", href: CHANGELOG_URL },
	},

	/** Editor toasts. `{version}` and `{headline}` are filled by `toastText`. */
	toast: {
		update: "✦ What's new in Adsum IoT Coder v{version}: {headline}.",
		cra: "Adsum IoT Coder v{version}: preview your project's CRA readiness from your build.",
		welcome:
			"✦ Welcome to Adsum IoT Coder: the free tier is on, no key needed · curated firmware expertise, credited to the engineers who wrote it.",
		cta: { update: "See what's new", cra: "Show me", welcome: "Open Adsum" },
	},

	/** Sample-run ids that wear the "New" badge this release. Empty means no badge anywhere. */
	newSamples: [] as readonly string[],

	/** Claims, not changes: what the product says it runs on, and what it names as not offered. */
	claims: {
		runsOn: [
			{
				family: "Nordic",
				sdk: "nRF Connect SDK · Zephyr",
				chips: ["nRF52", "nRF53", "nRF54L15", "nRF54LM20", "nRF9160", "nRF9161", "nRF9151"],
				protocols: ["BLE", "NB-IoT", "LTE-M", "GNSS", "NB-NTN"],
			},
			{
				family: "Espressif",
				sdk: "ESP-IDF",
				chips: ["ESP32", "ESP32-S3", "ESP32-C6"],
				protocols: ["Wi-Fi", "BLE"],
				note: "and the rest of the shipping range",
			},
			{
				family: "Products",
				sdk: "both chips, one workspace",
				chips: ["Fanstel LEW840X", "Fanstel BWG840X"],
				protocols: ["BLE", "Ethernet", "Wi-Fi", "cellular"],
			},
		] as readonly RunsOnRow[],
		runsOnNote:
			"Any board built with a supported chip: your own design, a reference board, a DK, or a product off the shelf. Cellular, NB-NTN and edge-AI runs need a free account; nothing else does. NTN needs LACA A1A silicon; DECT NR+ a modem image from Nordic sales.",
		/** Tied to AGENT_HANDOVER_ENABLED by the guard: the label and the switch cannot disagree. */
		notOffered: ["Bring your own coding agent"] as readonly string[],
	},
}

/** The announcement id. Changes when `version` changes, and only then. */
export function announcementId(): string {
	return RELEASE_NOTES.version
}

/** True when a package.json version has been reviewed here: the announced release, or an acknowledged patch. */
export function acknowledgesVersion(packageVersion: string): boolean {
	return packageVersion === RELEASE_NOTES.version || packageVersion in RELEASE_NOTES.patches
}

export function cardTitle(): string {
	return `What's new in v${RELEASE_NOTES.version}`
}

export type ToastKind = "update" | "cra" | "welcome"

/** `version` defaults to the announced release; a caller may name the one it is speaking about. */
export function toastText(kind: ToastKind, version: string = RELEASE_NOTES.version): string {
	return RELEASE_NOTES.toast[kind].replace("{version}", version).replace("{headline}", RELEASE_NOTES.headline)
}

export function toastCta(kind: ToastKind): string {
	return RELEASE_NOTES.toast.cta[kind]
}

export function isNewSample(id: string): boolean {
	return RELEASE_NOTES.newSamples.includes(id)
}
