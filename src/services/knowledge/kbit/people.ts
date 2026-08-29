/**
 * The credit roster — the profile a credited name links to.
 *
 * This used to be a hardcoded map inside the webview. Two things went wrong with that, both observed:
 * a new contributor could not be credited until someone cut a release, and one operator-confirmed URL
 * was lost outright when the branch carrying it never merged. A profile is data about a PERSON, so it
 * belongs in the registry — one entry serves every bit that person touched, instead of a URL being
 * copied into seventy frontmatters.
 *
 * Precedence is the same shape the bits themselves use: a BUNDLED baseline that always works offline,
 * with the REGISTRY layered on top when it can be reached. A blip costs a link, never a credit, and
 * never an exception.
 *
 * Resolution is by display name AND by handle, because a credit can carry either: the bits declare
 * `co_authors: [{handle, name}]`, and a bit that gives only a handle renders that handle as the name.
 *
 * The rule that does not change: never guess a profile. Linking the wrong human is worse than no link,
 * so an entry exists because an operator supplied it.
 */

/** Operator-confirmed profiles, compiled in. The floor: this is what an offline install shows. */
export const BUNDLED_PEOPLE: Readonly<Record<string, string>> = Object.freeze({
	"Ismail Hamdad": "https://www.linkedin.com/in/ismailhamdad/",
	"Nebil Alamin": "https://www.linkedin.com/in/nebil-alamin-71910521/",
	"Omar Morceli": "https://www.linkedin.com/in/omar-morceli/",
	"Redouane Elmagroud": "https://www.linkedin.com/in/red1profile/",
	"Yaman Kalaji": "https://www.linkedin.com/in/yrkalaji/",
})

export interface RegistryPerson {
	handle: string
	name: string
	url: string | null
}

/**
 * Build the lookup a credit line needs: every key a name might arrive as → its URL.
 *
 * Pure, so the precedence is testable without a network or a clock. Registry entries win over bundled
 * ones for the same key — a corrected link must be able to reach an installed extension — but a person
 * the registry does not mention keeps their bundled link rather than losing it.
 */
export function buildPeopleIndex(registry: RegistryPerson[] | null): Record<string, string> {
	const index: Record<string, string> = { ...BUNDLED_PEOPLE }
	for (const person of registry ?? []) {
		if (!person.url) {
			// A person with no confirmed URL is a legitimate row. It must not blank out a bundled link,
			// and it must not become an entry pointing nowhere.
			continue
		}
		index[person.name] = person.url
		index[person.handle] = person.url
	}
	return index
}

/**
 * The links for exactly the names in one credit line, or undefined when none of them resolve.
 *
 * Returning undefined rather than an empty object keeps the payload — and the transcript it is written
 * into — the size it was before this existed for the common single-author case.
 */
export function linksFor(names: Array<string | undefined>, index: Record<string, string>): Record<string, string> | undefined {
	const out: Record<string, string> = {}
	for (const name of names) {
		if (name && index[name]) {
			out[name] = index[name]
		}
	}
	return Object.keys(out).length > 0 ? out : undefined
}

// ── the live index ─────────────────────────────────────────────────────────────────────────────
// Held in memory rather than re-fetched per credit line: a session emits one credit per bit and there
// is no reason for any of them to wait on the network. Starts at the bundled baseline, so the very
// first credit of a cold session already links the people this build knows about.

let cachedIndex: Record<string, string> = buildPeopleIndex(null)

/** The index a credit line resolves against right now. Never empty — the bundled baseline is the floor. */
export function peopleIndex(): Record<string, string> {
	return cachedIndex
}

/**
 * Refresh from the registry. Silent by design: an unreachable registry leaves the previous index in
 * place, because a missing link is a cosmetic loss and an exception here would surface as a broken
 * credit line on an otherwise fine session.
 */
export async function refreshPeopleIndex(client: { fetchPeople(): Promise<RegistryPerson[] | null> }): Promise<boolean> {
	try {
		const people = await client.fetchPeople()
		if (!people) {
			return false
		}
		cachedIndex = buildPeopleIndex(people)
		return true
	} catch {
		return false
	}
}

/** Test seam: restore the baseline so one test's registry cannot leak into the next. */
export function resetPeopleIndexForTests(): void {
	cachedIndex = buildPeopleIndex(null)
}

/**
 * Attach the profile links for a credit's own names.
 *
 * Deliberately NOT done inside creditFromMeta: that module is pure by design and its header states the
 * rule it protects — attribution facts live in the bit, not in a host-side table. This does not break
 * that. Who curated a bit still comes only from the bit; what is added here is contact metadata about a
 * person, keyed by the person and never by the bit. Keeping it in a separate call keeps credit.ts
 * pure and testable without a network.
 */
export function withLinks<T extends { author?: string; attributed?: boolean; coAuthors?: string[] }>(credit: T): T {
	const names = [credit.attributed === false ? undefined : credit.author, ...(credit.coAuthors ?? [])]
	const links = linksFor(names, peopleIndex())
	return links ? { ...credit, links } : credit
}
