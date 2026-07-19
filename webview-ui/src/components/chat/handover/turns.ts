import type { HandoverStrip, MilestoneRow } from "@shared/handover"

/**
 * Milestones → conversation turns (mockup mcp-sdk/12).
 *
 * A handed-over session renders as a CONVERSATION, so the flat time-ordered milestone rows regroup
 * into turns: the developer's mission opens, Adsum speaks when it did something, and each agent
 * checkpoint becomes a turn — its bubble is the milestone text, the ⚙/⇢/⎘ rows that happened since
 * the previous checkpoint become its collapsed evidence, the bits it loaded become its credit line.
 *
 * Pure and unit-tested: the regrouping is presentation LOGIC, not presentation — a wrong attachment
 * (evidence under the wrong turn, a nudge on the wrong checkpoint) would misreport who did what when.
 */

export interface Credit {
	title: string
	author: string
	version?: string
}

export type Turn =
	/** the developer: the opening mission, and any typed message (queued until the agent's next milestone) */
	| { speaker: "you"; at: string; text: string; queued?: boolean }
	/** Adsum, only when it DID something: posted the session, or is closing it out */
	| { speaker: "adsum"; at: string; kind: "posted" | "closed"; text: string }
	/** the agent: one turn per reported milestone, with its evidence and credits */
	| {
			speaker: "agent"
			at: string
			step?: string
			text: string
			evidence: MilestoneRow[]
			credits: Credit[]
			nudges: string[]
	  }
	/** evidence that accumulated after the last checkpoint — work in flight, not yet reported */
	| { speaker: "agent"; at: string; inProgress: true; evidence: MilestoneRow[]; credits: Credit[] }

export function buildTurns(strip: HandoverStrip): Turn[] {
	const turns: Turn[] = []
	turns.push({ speaker: "you", at: strip.startedAt, text: strip.mission })
	turns.push({
		speaker: "adsum",
		at: strip.startedAt,
		kind: "posted",
		text: [
			`Posted to your agent with ${strip.packed.bits} knowledge bit${strip.packed.bits === 1 ? "" : "s"}`,
			strip.packed.governing ? `guided by ${strip.packed.governing.title}` : null,
			strip.baseline.created ? "safety snapshot created" : null,
		]
			.filter(Boolean)
			.join(" · "),
	})

	// One credit line per bit per session (the credit law): first load shows it, repeats stay silent.
	const creditedIds = new Set<string>()
	let evidence: MilestoneRow[] = []
	let credits: Credit[] = []
	const flushInProgress = (at: string) => {
		if (evidence.length || credits.length) {
			turns.push({ speaker: "agent", at, inProgress: true, evidence, credits })
			evidence = []
			credits = []
		}
	}

	for (const row of strip.milestones) {
		switch (row.kind) {
			case "bit": {
				const key = `${row.title}@${row.version ?? ""}`
				if (!creditedIds.has(key)) {
					creditedIds.add(key)
					credits.push({ title: row.title, author: row.author, version: row.version })
				}
				break
			}
			case "tool":
			case "host":
			case "snap":
				evidence.push(row)
				break
			case "msg":
				// a typed message interleaves as its own "you" turn; pending evidence stays pending
				turns.push({ speaker: "you", at: row.t, text: row.text, queued: !row.delivered })
				break
			case "step":
				turns.push({ speaker: "agent", at: row.t, step: row.step, text: row.text, evidence, credits, nudges: [] })
				evidence = []
				credits = []
				break
			case "nudge": {
				// derived nudges carry their checkpoint's timestamp and sort just after it — attach to the
				// LAST agent turn, never to the next one (misattribution would blame the wrong milestone)
				const last = [...turns].reverse().find((t) => t.speaker === "agent" && !("inProgress" in t))
				if (last && "nudges" in last) {
					last.nudges.push(row.text)
				}
				break
			}
		}
	}
	flushInProgress(strip.milestones[strip.milestones.length - 1]?.t ?? strip.startedAt)

	if (strip.phase === "closed" && strip.closing) {
		turns.push({
			speaker: "adsum",
			at: strip.closedAt ?? strip.startedAt,
			kind: "closed",
			text: "Session closed cleanly. Continue here resumes it in Adsum with everything it did.",
		})
	}
	return turns
}
