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
}

/** The pairing as a sentence of its own ("The first time, ..."), or nothing when this computer is paired already. */
const pairingSentence = (platform?: string, bonded?: boolean | null) => {
	const w = blg20PairingWords(platform, bonded)
	return w ? `${w[0].toUpperCase()}${w.slice(1)}. ` : ""
}

export function unitActions(u: Blg20Unit, platform?: string): UnitAction[] {
	const name = blg20Label(u)
	const ble = blg20OverBluetooth(u)
	const via = ble ? ` --ble ${blg20BleTarget(u)}` : ""
	const door = ble ? "over Bluetooth" : "on its USB-C service port"
	const pairing = ble
		? ` ${pairingSentence(platform, u.bonded)}If it is not found, its commissioning window is closed: tell me to hold its button for three seconds.`
		: ""
	return [
		{
			label: "What is this gateway?",
			testId: "unit-action-passport",
			prompt:
				`What is this gateway (${name}, ${door})? Read its passport and what it needs with ` +
				`\`blg20-service passport${via} --json\` and \`blg20-service needs${via} --json\`, and tell me in plain words ` +
				`what it is and what it still needs. Reading needs no key and changes nothing.${pairing}`,
		},
		{
			label: "Claim it",
			testId: "unit-action-claim",
			prompt:
				`Claim ${name} for this computer. First say in one sentence what claiming means, then run ` +
				`\`blg20-service claim${via} --json\` and tell me where the key is so I can back it up.` +
				(ble ? " A claim over Bluetooth needs the unit's commissioning window open." : "") +
				pairing,
		},
		{
			label: "Read the logs",
			testId: "unit-action-logs",
			prompt:
				`Read the recent logs of both halves of ${name} ${door} (\`blg20-service logs --chip ble${via} --json\` and ` +
				`\`blg20-service logs --chip lte${via} --json\`; they need the owner key) and tell me what they show.${pairing}`,
		},
	]
}

/** "Set it up" for a unit over Bluetooth: the new-unit journey, on the service port it actually has. */
export function bleSetUpPrompt(u: Blg20Unit, platform?: string): string {
	return (
		`A Fanstel ${blg20Label(u)} gateway is in Bluetooth range of this computer (its USB-C carries power only). ` +
		"LOAD products/fanstel/blg20x/PRODUCT.md and follow its new-unit journey on the service port over Bluetooth " +
		`(\`blg20-service <verb> --ble ${blg20BleTarget(u)} --json\`): tell me what the unit is and what it still needs, ` +
		`claim it only when I say so, then check whether it needs an update, then guide me through commissioning. ${pairingSentence(platform, u.bonded)}`.trimEnd()
	)
}
