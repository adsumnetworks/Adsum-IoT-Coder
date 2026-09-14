/**
 * The demo pairs, as the tool bits the registry serves, keyed by the group that opens them.
 *
 * Shared so the host, which knows what the registry serves this account, and the panel, which draws the
 * card, name the same tools. [14 Sep 2026] The LEW840x pair was withdrawn from the registry while the card
 * still offered it to every registered account: a card whose images cannot be fetched is worse than no card.
 */
export const DEMO_PAIR_TOOLS: Readonly<Record<string, readonly string[]>> = {
	"lew840x-demo-hex": ["adsum/tools/lew840x-hex-lte-demo", "adsum/tools/lew840x-hex-esp32-lte"],
	"blg20-demo-hex": ["adsum/tools/blg20-hex-demo-pair"],
}

/** Every demo-pair tool, once each — what the host looks up in the manifest. */
export const ALL_DEMO_PAIR_TOOLS: readonly string[] = [...new Set(Object.values(DEMO_PAIR_TOOLS).flat())]

/**
 * False only when the host has read the registry and it does not serve every tool of this pair.
 *
 * Absent means the host has not read the manifest yet, and that answer is "do not hide": a card that
 * flickers away for the second it takes to read the catalog would teach a partner the demo comes and goes.
 */
export function demoPairServed(servedDemoTools: readonly string[] | undefined, group: string): boolean {
	if (!servedDemoTools) {
		return true
	}
	return (DEMO_PAIR_TOOLS[group] ?? []).every((id) => servedDemoTools.includes(id))
}
