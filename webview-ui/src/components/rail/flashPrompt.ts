import { TAB_TITLE_MAX, tabTitle } from "./unitActions"

/**
 * [0.5 the firmware lane] The prompt the Flash button sends: what to flash, for whom, from where, and the
 * ways onto the unit that THIS folder makes possible, read from its own files rather than assumed from the
 * family. Each way names the knowledge bit that carries its procedure, so the agent follows the curated
 * steps instead of improvising them: a `usb/release.json` is an update over the service port; `*.hex`
 * files are a load over the debug probes; an `esp32/flasher_args.json` is a LEW840x, whose three chips are
 * flashed as its own flash bit lays out. Pure, so every route is tested.
 */
export interface FlashPromptInput {
	title: string
	version: string
	licensee: string
	folder: string
	files: readonly string[]
	/** The firmware family (blg20x, lbg20x, lew840x): it picks the bit that carries each procedure. */
	family?: string | null
	/** The licence term has ended: the files still flash, and the prompt says so. */
	expiredOn?: string
	/**
	 * A route only the unit can tell (the LBG20x over Bluetooth): one sentence, put first as a way of its own.
	 * The Bluetooth lane fills this from the unit on the desk; nothing here guesses it.
	 */
	unitRoute?: string
}

/** The bits that carry each procedure. The LBG20x shares the BLG20x's firmware, service port and two halves. */
const BLG20_USB_BIT = "products/fanstel/blg20x/usb-service-port.md"
const BLG20_PROBES_BIT = "products/fanstel/blg20x/beats/s2-flash-the-demo.md"
const LEW840X_FLASH_BIT = "products/fanstel/lew840x/gateway-flash.md"

const has = (files: readonly string[], re: RegExp) => files.some((f) => re.test(f))
const list = (paths: readonly string[], at: (p: string) => string, joiner = ", ") => paths.map((p) => `\`${at(p)}\``).join(joiner)

/**
 * The tab title of a flash session: "Flash LBG20x demo pair v1.0.0". A long product name gives way before the
 * version does: the version is what tells two flash tabs apart.
 */
export function flashTitle(i: Pick<FlashPromptInput, "title" | "version">): string {
	const version = ` v${i.version}`
	const room = Math.max(TAB_TITLE_MAX - "Flash ".length - version.length, 1)
	const name = i.title.length > room ? `${i.title.slice(0, room - 1).trimEnd()}…` : i.title
	return tabTitle(`Flash ${name}${version}`)
}

export function flashPrompt(i: FlashPromptInput): string {
	const f = i.files
	const at = (p: string) => `${i.folder}/${p}`
	const family = (i.family ?? "").toLowerCase()
	const blg20Line = family === "blg20x" || family === "lbg20x"
	const ways: string[] = []
	if (i.unitRoute) {
		ways.push(i.unitRoute)
	}
	const hexes = f.filter((p) => /\.hex$/i.test(p))
	if (family === "lew840x" || has(f, /^esp32\/flasher_args\.json$/)) {
		// One way, three chips: the ESP32 through the flash-cycle tool (it reads the offsets from
		// flasher_args.json and refuses to write until the download switch has settled), the radio card's
		// scanner (one image, chosen by the card fitted), and the cellular card's bearer.
		const chips: string[] = []
		if (has(f, /^esp32\/flasher_args\.json$/)) {
			chips.push(
				`the ESP32 with \`esp-flash-cycle --port <its port> --build ${at("esp32")}\`, never a hand-typed esptool write`,
			)
		}
		const scanners = hexes.filter((p) => p.startsWith("ble/"))
		if (scanners.length) {
			chips.push(
				scanners.length > 1
					? `the radio card's Bluetooth scanner, ONE of ${list(scanners, at, " or ")} (the \`-lr\` image for a long-range card: read the card first)`
					: `the radio card's Bluetooth scanner, ${list(scanners, at)}`,
			)
		}
		const bearers = hexes.filter((p) => p.startsWith("lte/"))
		if (bearers.length) {
			chips.push(`the cellular card's bearer, ${list(bearers, at)}, when that card is fitted`)
		}
		ways.push(
			`as \`${LEW840X_FLASH_BIT}\` lays it out, with these images in place of the ones its tools would install: ${chips.join("; ")}`,
		)
	} else {
		// The LBG20x has no USB data path (its USB-C carries power only): its update goes over Bluetooth, the unit's route.
		if (has(f, /^usb\/release\.json$/) && family !== "lbg20x") {
			const ble = f.find((p) => /^usb\/.+\/ble\.signed\.bin$/.test(p))
			const lte = f.find((p) => /^usb\/.+\/lte\.signed\.bin$/.test(p))
			const steps = [ble && `\`update-ble ${at(ble)}\``, lte && `\`update-lte ${at(lte)}\``].filter(Boolean).join(" then ")
			ways.push(
				`over its USB service port, an update, as \`${BLG20_USB_BIT}\` lays it out: \`blg20-service update-check ${at("usb")}\` names the steps, then ${steps}, Bluetooth first (a claimed unit, the owner key on this computer)`,
			)
		}
		if (hexes.length) {
			ways.push(
				blg20Line
					? `over the debug probes, a factory load that clears the settings, as \`${BLG20_PROBES_BIT}\` lays it out (the cellular half's protection word, the shared reset line): ${list(hexes, at)}, one image per half with nrfutil`
					: `over the debug probes: ${list(hexes, at)}, one image per chip with nrfutil`,
			)
		}
	}
	const how =
		ways.length > 1
			? ` The ways onto the unit: ${ways.map((w, n) => `(${n + 1}) ${w}`).join("; ")}.`
			: ways.length === 1
				? ` The way onto the unit: ${ways[0]}.`
				: ""
	const term = i.expiredOn
		? ` The licence term ended on ${i.expiredOn}; the files still flash, and renewal is a request from the Hardware page.`
		: ""
	return (
		`Flash ${i.title} v${i.version}, licensed to ${i.licensee}, from ${i.folder}.` +
		// The bits that carry a flash also run inside guided journeys; the host knows this one came on its own.
		" This is a flash on its own, from the Hardware page, not a guided first run." +
		` Read ${at("adsum-firmware.json")} for the files and their hashes, and say the flash line first.` +
		how +
		term +
		// 11 Oct 2026, the bench: a unit on a newer build was taken down two versions without a word, and the
		// summary named the wrong ones. The button names a folder; it does not say the developer wants older.
		" Before you write anything, read what the unit runs now and say it beside this version: if this is older than what it runs, say plainly that it is a downgrade and ask me first." +
		" Ask me which way, and which probe or port is which, before you program anything."
	)
}
