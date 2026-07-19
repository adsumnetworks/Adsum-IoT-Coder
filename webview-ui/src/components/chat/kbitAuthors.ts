/**
 * Author registry — LinkedIn profiles for the people credited in K-bit attributions.
 *
 * Static on purpose (design/01: "author bios from a small static registry; registry-served profiles
 * later"): a profile URL is contact metadata about a PERSON, not curated knowledge about a bit, so it does
 * not belong in 70+ bit frontmatters — one entry here serves every bit the person authored.
 *
 * Rules:
 *  - Only operator-confirmed URLs. Never guess a profile: linking the wrong human is worse than no link.
 *  - A name absent here (or the "Adsum authoring team" fallback) renders as plain text — the absence of a
 *    link is honest, not broken.
 */
export const AUTHOR_LINKS: Record<string, string> = {
	"Ismail Hamdad": "https://www.linkedin.com/in/ismailhamdad/",
	"Omar Morceli": "https://www.linkedin.com/in/omar-morceli/",
	"Redouane Elmagroud": "https://www.linkedin.com/in/red1profile/",
	"Yaman Kalaji": "https://www.linkedin.com/in/yrkalaji/",
}

export function authorLink(name: string | undefined): string | undefined {
	return name ? AUTHOR_LINKS[name] : undefined
}
