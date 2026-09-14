/**
 * Entitlement groups as a developer reads them. Ids are ours; these words are theirs. Shared so the account
 * menu in the panel header and the Account section in settings cannot describe the same account differently.
 */
export const GROUP_WORDS: Record<string, string> = {
	"cellular-advanced": "Advanced cellular",
	"edge-ai-advanced": "On-device inference",
	"lew840x-demo-hex": "LEW840x demo images",
	"lew840x-prod-hex": "LEW840x production images",
	"lew840x-ble-src": "LEW840x BLE source",
	"lew840x-esp-src": "LEW840x ESP32 source",
	"lew840x-9160-src": "LEW840x full source",
	"blg20-demo-hex": "BLG20x demo images",
	"blg20-prod-hex": "BLG20x production images",
	"blg20-ble-src": "BLG20x Bluetooth-half source",
	"blg20-esp-src": "BLG20x ESP source",
	"blg20-9151-src": "BLG20x radio-half source",
	"blg20-early-access": "BLG20x gateway card",
	"blg20-adv-ble": "BLG20x advanced knowledge, Bluetooth half",
	"blg20-adv-full": "BLG20x advanced knowledge, whole gateway",
	all: "Everything",
}

/** One plain line of what an account opens. Unknown ids are left out rather than shown raw. */
export function groupLine(groups: readonly string[]): string {
	const words = groups.map((g) => GROUP_WORDS[g]).filter((w): w is string => !!w)
	return words.length === 0 ? "Nothing extra yet" : words.join(" · ")
}
