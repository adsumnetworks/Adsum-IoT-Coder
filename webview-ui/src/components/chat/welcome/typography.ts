/**
 * The entry surfaces' type scale — five sizes, two weights, one tracking value.
 *
 * [SWEEP 2026-09-04] Measured before this existed: fifteen distinct font sizes across the
 * welcome, the drawer, the cards, the strip and the credits — 8.5, 9, 9.5, 10, 10.5, 11, 11.5,
 * 12, 12.5, 13, 13.5, 14, 15, 16 — with four letter-spacings, three weights, eleven gap values
 * and twenty-five padding values. Each was reasonable where it was written; together they are
 * why the surface read as tuned rather than designed. Half-pixel sizes also render differently
 * per platform. Five roles on VS Code's 13-px base, and every text on these surfaces is one of
 * them. Spacing sits on a 4-px grid (Tailwind's 1 / 2 / 3 / 4).
 */
export const TYPE = {
	/** Section heads: ENVIRONMENT, SUGGESTED RUNS, RECENT SESSIONS. The only tracked text. */
	label: { fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase" as const },
	/** Ages, reasons, hints, the tip, the strip's status. */
	meta: { fontSize: "11px" },
	/** Row titles, descriptions, the filter, drawer text. */
	body: { fontSize: "12px" },
	/** The folder, card titles, the resume title. */
	title: { fontSize: "13px", fontWeight: 600 },
	/** The one-line headline on a cold start or a lapsed return. */
	headline: { fontSize: "14px", fontWeight: 600 },
} as const
