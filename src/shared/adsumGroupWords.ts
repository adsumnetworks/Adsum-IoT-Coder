/**
 * Entitlement groups as a developer reads them. Ids are ours; these words are theirs. Shared so the account
 * menu in the panel header and the Account section in settings cannot describe the same account differently.
 */
export const GROUP_WORDS: Record<string, string> = {
	"cellular-advanced": "Advanced cellular",
	"edge-ai-advanced": "On-device inference",
	"lew840x-demo-hex": "LEW840x demo hexes",
	"lew840x-prod-hex": "LEW840x production hexes",
	"lew840x-ble-src": "LEW840x BLE source",
	"lew840x-esp-src": "LEW840x ESP source",
	"lew840x-9160-src": "LEW840x nRF9160 source",
	"blg20-demo-hex": "BLG20 demo hexes",
	"blg20-prod-hex": "BLG20 production hexes",
	"blg20-ble-src": "BLG20 BLE source",
	"blg20-esp-src": "BLG20 ESP source",
	"blg20-9151-src": "BLG20 nRF9151 source",
	all: "Everything",
}

/** One plain line of what an account opens. Unknown ids are left out rather than shown raw. */
export function groupLine(groups: readonly string[]): string {
	const words = groups.map((g) => GROUP_WORDS[g]).filter((w): w is string => !!w)
	return words.length === 0 ? "Nothing extra yet" : words.join(" · ")
}
