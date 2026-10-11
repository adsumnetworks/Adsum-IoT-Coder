import { type Blg20Unit, blg20BleTarget, blg20Label, blg20OverBluetooth, blg20PairingWords } from "@shared/blg20"

/**
 * [10 Oct 2026] The unit's own actions on the Hardware page, each opening a session with its first line written:
 * what it is, claim it, read its logs. Over Bluetooth (the LBG20x, whose USB-C carries power only) every command
 * names the unit with `--ble <its four digits>`; on its cable the tool finds it by itself.
 */
export interface UnitAction {
	label: string
	testId: string
	prompt: string
	/** The session tab's first title: what was asked and of which unit ("Claim · LBG20x AD50"). */
	title: string
	/** The unit's guard key, so the host continues in the session that already holds the unit. */
	unit?: string
}

/** The host cuts a tab's first title at this length; a title built here is cut the same way, where it is made. */
export const TAB_TITLE_MAX = 48

/** One line for a tab, never longer than the host shows. */
export const tabTitle = (title: string): string => {
	const t = title.split(" ").filter(Boolean).join(" ")
	return t.length > TAB_TITLE_MAX ? `${t.slice(0, TAB_TITLE_MAX - 1).trimEnd()}…` : t
}

/** The door a unit's commands go through: Bluetooth when it has no service port on USB, else its cable. */
export type UnitDoor = "ble" | "usb"

export const unitDoor = (u: Blg20Unit): UnitDoor => (blg20OverBluetooth(u) ? "ble" : "usb")

const FOUR_HEX = /^[0-9A-F]{4}$/
const TWELVE_HEX = /^[0-9A-F]{12}$/

/**
 * [0.5.1] The name the host's port guard keeps a unit under, so a Hardware page button can continue in the session
 * that already holds the unit instead of opening one more tab the first would refuse it to. Over Bluetooth it is
 * `BLE:` and the unit's four digits ("BLE:AD50"), read from its name, from the address in its advertised name, or
 * from a MAC. On its cable it is the service port as the guard stores it: upper-cased, with macOS's `/dev/cu.`
 * read as `/dev/tty.` ("/DEV/TTYACM4", "COM7"). A unit that cannot be named this way (a probe pair, nothing
 * known) has no key, and its button opens a session of its own as before.
 */
export function unitGuardKey(u: Blg20Unit | undefined, door?: UnitDoor): string | undefined {
	if (!u) {
		return undefined
	}
	if ((door ?? unitDoor(u)) === "ble") {
		if (!u.bleAddress) {
			return undefined
		}
		const mac = u.bleAddress.split(/[:-]/).join("").toUpperCase()
		const digits = [u.name, u.bleId?.slice(-4), TWELVE_HEX.test(mac) ? mac.slice(-4) : undefined]
			.map((d) => d?.trim().toUpperCase())
			.find((d) => !!d && FOUR_HEX.test(d))
		return digits ? `BLE:${digits}` : undefined
	}
	const port = u.servicePort?.trim()
	if (!port) {
		return undefined
	}
	const CU = "/dev/cu."
	return (port.startsWith(CU) ? `/dev/tty.${port.slice(CU.length)}` : port).toUpperCase()
}

/** The tab title of the set-up journey: "Set up LBG20x AD50". `name` is the board's label when no unit is known. */
export const setUpTitle = (name: string): string => tabTitle(`Set up ${name}`)

/** The pairing as a sentence of its own ("The first time, ..."), or nothing when this computer is paired already. */
const pairingSentence = (platform?: string, bonded?: boolean | null, bleId?: string) => {
	const w = blg20PairingWords(platform, bonded, bleId)
	return w ? `${w[0].toUpperCase()}${w.slice(1)}. ` : ""
}

export function unitActions(u: Blg20Unit, platform?: string): UnitAction[] {
	const name = blg20Label(u)
	const ble = blg20OverBluetooth(u)
	const via = ble ? ` --ble ${blg20BleTarget(u)}` : ""
	const door = ble ? "over Bluetooth" : "on its USB-C service port"
	const pairing = ble
		? ` ${pairingSentence(platform, u.bonded, u.bleId)}If it is not found, its commissioning window is closed: tell me to hold its button for three seconds.`
		: ""
	// Every action names its tab and the unit it is about, by the door its own commands use.
	const unit = unitGuardKey(u, ble ? "ble" : "usb")
	const titled = (what: string) => ({ title: tabTitle(`${what} · ${name}`), ...(unit ? { unit } : {}) })
	return [
		{
			...titled("What is this gateway?"),
			label: "What is this gateway?",
			testId: "unit-action-passport",
			prompt:
				`What is this gateway (${name}, ${door})? Read its passport and what it needs with ` +
				`\`blg20-service passport${via} --json\` and \`blg20-service needs${via} --json\`, and tell me in plain words ` +
				`what it is and what it still needs. Reading needs no key and changes nothing.${pairing}`,
		},
		{
			...titled("Claim"),
			label: "Claim it",
			testId: "unit-action-claim",
			prompt:
				`Claim ${name} for this computer. First say in one sentence what claiming means, then run ` +
				`\`blg20-service claim${via} --json\` and tell me where the key is so I can back it up.` +
				(ble ? " A claim over Bluetooth needs the unit's commissioning window open." : "") +
				pairing,
		},
		{
			...titled("Logs"),
			label: "Read the logs",
			testId: "unit-action-logs",
			prompt:
				`Read the recent logs of both halves of ${name} ${door} (\`blg20-service logs --chip ble${via} --json\` and ` +
				`\`blg20-service logs --chip lte${via} --json\`; they need the owner key) and tell me what they show.${pairing}`,
		},
	]
}

/** The commissioning session's tab: "Commission LBG20x AD50", or "Change LBG20x AD50" once it is commissioned. */
export const commissionTitle = (u: Blg20Unit): string =>
	tabTitle(`${u.commission?.commissioned ? "Change" : "Commission"} ${blg20Label(u)}`)

/**
 * [11 Oct 2026] The Hardware page's fourth step: commission the unit from this computer, over the Bluetooth link the
 * page already paired. The knowledge bit carries the order, the questions and the words; the prompt only opens it.
 */
export function bleCommissionPrompt(u: Blg20Unit, platform?: string): string {
	const name = blg20Label(u)
	const d = blg20BleTarget(u)
	const done = u.commission?.commissioned === true
	return (
		(done
			? `Change how ${name} is commissioned, from this computer over Bluetooth. `
			: `Commission ${name} from this computer over Bluetooth. `) +
		"LOAD products/fanstel/blg20x/commission-from-the-coder.md and follow it: read the unit first with " +
		`\`blg20-service prov status --ble ${d} --json\` and tell me in one sentence what it holds, ` +
		(done
			? "then ask me what to change, write only that and read it back, then start the unit again and give me its verdict. "
			: "then guide me one question at a time (where it is, its name and key, its Wi-Fi if it has the part, the network, the platform), writing each step and reading it back, then start it and give me its verdict. ") +
		"Use the site profile adsum-site.json when there is one, and keep the key in the fleet register only. " +
		pairingSentence(platform, u.bonded, u.bleId)
	).trimEnd()
}

/** "Set it up" for a unit over Bluetooth: the new-unit journey, on the service port it actually has. */
export function bleSetUpPrompt(u: Blg20Unit, platform?: string): string {
	return (
		`A Fanstel ${blg20Label(u)} gateway is in Bluetooth range of this computer (its USB-C carries power only). ` +
		"LOAD products/fanstel/blg20x/PRODUCT.md and follow its new-unit journey on the service port over Bluetooth " +
		`(\`blg20-service <verb> --ble ${blg20BleTarget(u)} --json\`): tell me what the unit is and what it still needs, ` +
		`claim it only when I say so, then check whether it needs an update, then guide me through commissioning. ${pairingSentence(platform, u.bonded, u.bleId)}`.trimEnd()
	)
}
