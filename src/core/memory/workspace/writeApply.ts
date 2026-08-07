/**
 * Routing for an ACCEPTED memory write — the only place that decides which file a target lands in.
 *
 * Split from writeRules.ts (pure decisions) and from the tool handler (UI + approval) so the three
 * concerns can be changed and tested independently. This module touches disk, but only through
 * store.ts, which means every write here inherits its atomicity, its fail-open behaviour, and its
 * refusal to overwrite a section a human has edited by hand.
 *
 * Routing, and why:
 *
 *   goal, defect  → `.adsum/status.json`. Machine-checkable, committed with the repo, and rendered
 *                   into the volatile tail block on every turn, which is where the model actually
 *                   reads it.
 *
 *   hw-asserted   → the `hardware-asserted` section of `.adsum/PROJECT.md`, ALWAYS; plus a mirror
 *                   into `local/devices.json.mode` when the supplied id names a device we already
 *                   know about. PROJECT.md is the primary because it is the only one of the two
 *                   that reaches the system prompt — a fact written solely into devices.json would
 *                   be recorded and then never shown to anybody, which is the same as losing it.
 *                   The devices.json mirror exists because `mergeDevices()` explicitly protects
 *                   `mode` from being clobbered by a re-probe, so the fact also survives in a
 *                   structured, per-bench, gitignored form attached to the board it describes.
 *
 *   note          → `.adsum/notes/<slug>.md`, plus a one-line entry in PROJECT.md's notes index.
 *                   The body is never injected; the index line is the only thing the model sees
 *                   before deciding to `read_file` it. That asymmetry is what lets notes be
 *                   generous while the injected memory stays small.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { checkSectionWriteSize } from "../memoryLimits"
import { type AdsumPaths, resolveAdsumPaths } from "./paths"
import {
	ensureAdsumScaffold,
	readDevices,
	readProjectMd,
	readStatus,
	writeAtomic,
	writeDevices,
	writeProjectMdSection,
	writeStatus,
} from "./store"
import {
	ASSERTED_SECTION_ID,
	applyDefect,
	applyGoal,
	assertedBullet,
	assertedBulletHasId,
	NOTES_SECTION_ID,
	type NoteIndexEntry,
	noteTitle,
	parseAssertedBullets,
	parseDefectFields,
	parseNotesIndex,
	renderAssertedBody,
	renderNotesIndexBody,
	summarizeNote,
	type WriteAccepted,
} from "./writeRules"

export interface ApplyResult {
	ok: boolean
	/** Handed straight back to the model. On success it always names the ABSOLUTE path written. */
	message: string
}

const fail = (message: string): ApplyResult => ({ ok: false, message })

/** Every success ends the same way, because the model has no other way to find these files. */
function wrote(what: string, absPath: string, extra?: string): ApplyResult {
	return {
		ok: true,
		message: `${what}\n\nWritten to: ${absPath}${extra ? `\n${extra}` : ""}\n\nThis survives compaction and new tasks. read_file that path when you need the full record.`,
	}
}

/** A section fence a human has edited outranks anything we would have written into it. */
function sectionResultMessage(result: string, sectionId: string, projectMd: string): string | undefined {
	if (result === "skipped-user-edited") {
		return (
			`Not written: the '${sectionId}' section of ${projectMd} has been edited by hand since it was last ` +
			`generated, so your write was skipped rather than overwriting the developer's words. Their correction ` +
			`outranks yours. If you still believe the section is wrong, say so in your reply instead of rewriting it.`
		)
	}
	if (result === "failed") {
		return `Not written: ${projectMd} could not be updated (it may be read-only or locked). Nothing was changed.`
	}
	return undefined
}

export function applyMemoryWrite(cwd: string | undefined, w: WriteAccepted, nowIso: string): ApplyResult {
	const paths = ensureAdsumScaffold(cwd) ?? safePaths(cwd)
	if (!paths) {
		return fail("Not written: no workspace folder is open, so there is nowhere to persist project memory.")
	}
	switch (w.target) {
		case "goal":
			return applyGoalWrite(cwd, paths, w, nowIso)
		case "defect":
			return applyDefectWrite(cwd, paths, w, nowIso)
		case "hw-asserted":
			return applyAssertedWrite(cwd, paths, w, nowIso)
		case "note":
			return applyNoteWrite(cwd, paths, w)
	}
}

function safePaths(cwd: string | undefined): AdsumPaths | undefined {
	try {
		return resolveAdsumPaths(cwd)
	} catch {
		return undefined
	}
}

// ── goal ─────────────────────────────────────────────────────────────────────────

function applyGoalWrite(cwd: string | undefined, paths: AdsumPaths, w: WriteAccepted, nowIso: string): ApplyResult {
	const before = readStatus(cwd)
	const after = applyGoal(before, w.content, nowIso)
	if (!writeStatus(cwd, after)) {
		return fail("Not written: status.json could not be updated (it may be read-only or locked).")
	}
	const priorCount = after.priorGoals?.length ?? 0
	const note =
		before.goal && before.goal.text !== after.goal?.text
			? `The previous goal ("${before.goal.text}") was kept as prior-goal history — ${priorCount} recorded. Nothing was deleted.`
			: undefined
	return wrote("Goal recorded.", paths.statusJson, note)
}

// ── defect ───────────────────────────────────────────────────────────────────────

function applyDefectWrite(cwd: string | undefined, paths: AdsumPaths, w: WriteAccepted, nowIso: string): ApplyResult {
	const status = readStatus(cwd)
	const res = applyDefect(status, w.op, w.id as string, parseDefectFields(w.content), nowIso)
	if (!res.ok) {
		return fail(res.reason)
	}
	if (!writeStatus(cwd, res.status)) {
		return fail("Not written: status.json could not be updated (it may be read-only or locked).")
	}
	return wrote(res.summary, paths.statusJson, "Open defects are recited to you at the end of every turn.")
}

// ── hw-asserted ──────────────────────────────────────────────────────────────────

function applyAssertedWrite(cwd: string | undefined, paths: AdsumPaths, w: WriteAccepted, nowIso: string): ApplyResult {
	const md = readProjectMd(cwd)
	const existing = parseAssertedBullets(md)
	const bullet = assertedBullet(w.id, w.content)

	let next: string[]
	if (w.op === "delete") {
		const id = w.id as string
		next = existing.filter((b) => !assertedBulletHasId(b, id))
		if (next.length === existing.length) {
			return fail(`No asserted hardware fact is recorded for '${id}', so there is nothing to delete.`)
		}
	} else if (w.op === "set") {
		// `set` replaces the fact for THIS board only. Replacing the whole list would let one write
		// silently delete facts about every other board on the bench.
		next = w.id ? existing.filter((b) => !assertedBulletHasId(b, w.id as string)).concat(bullet) : [bullet]
	} else {
		next = existing.includes(bullet) ? existing : [...existing, bullet]
	}

	const result = writeProjectMdSection(cwd, ASSERTED_SECTION_ID, renderAssertedBody(next))
	const problem = sectionResultMessage(result, ASSERTED_SECTION_ID, paths.projectMd)
	if (problem) {
		return fail(problem)
	}

	const mirrored = mirrorDeviceMode(cwd, w, nowIso)
	return wrote(
		w.op === "delete" ? "Asserted hardware fact removed." : "Asserted hardware fact recorded.",
		paths.projectMd,
		mirrored,
	)
}

/**
 * Also stamp the fact on the device record when the id names a board we already know.
 *
 * `mergeDevices()` promises never to let a probe overwrite `mode`, so this copy is the one that
 * cannot be lost by a re-detection — and it keeps the fact attached to the board rather than
 * floating in a prose list. It is a mirror, not the primary: devices.json is gitignored and is not
 * injected into the prompt, so on its own it would record the fact and never show it to anyone.
 */
function mirrorDeviceMode(cwd: string | undefined, w: WriteAccepted, nowIso: string): string | undefined {
	if (!w.id) {
		return undefined
	}
	const devices = readDevices(cwd)
	const idx = devices.devices.findIndex((d) => d.id === w.id)
	if (idx < 0) {
		return undefined
	}
	const mode = w.op === "delete" ? undefined : w.content.replace(/\s+/g, " ").trim()
	const next = { ...devices, devices: [...devices.devices] }
	next.devices[idx] = { ...next.devices[idx], mode, lastSeenAt: next.devices[idx].lastSeenAt ?? nowIso }
	if (!writeDevices(cwd, next)) {
		return undefined
	}
	return `Also mirrored onto known device '${w.id}' (mode) so a re-probe cannot lose it.`
}

// ── note ─────────────────────────────────────────────────────────────────────────

function applyNoteWrite(cwd: string | undefined, paths: AdsumPaths, w: WriteAccepted): ApplyResult {
	const slug = w.id as string
	const file = path.join(paths.notesDir, `${slug}.md`)
	const existing = readNote(file)

	if (w.op === "delete") {
		if (existing === undefined) {
			return fail(`No note '${slug}' exists at ${file}, so there is nothing to delete.`)
		}
		try {
			fs.rmSync(file, { force: true })
		} catch {
			return fail(`Not written: ${file} could not be removed.`)
		}
		const problem = updateNotesIndex(cwd, paths, (entries) => entries.filter((e) => e.path !== file))
		return problem ? fail(problem) : wrote(`Note '${slug}' deleted.`, file)
	}

	const body = w.op === "append" && existing ? `${existing.trimEnd()}\n\n${w.content.trim()}\n` : `${w.content.trim()}\n`
	// The cap is on the FILE, not on the increment — otherwise an unbounded note is reachable in
	// small appends, and notes are the one place with a generous budget precisely because they are
	// never injected.
	const tooBig = checkSectionWriteSize("note", body)
	if (tooBig) {
		return fail(tooBig)
	}
	if (!writeAtomic(file, body)) {
		return fail(`Not written: ${file} could not be written (the folder may be read-only).`)
	}

	const entry: NoteIndexEntry = { title: noteTitle(slug, body), summary: summarizeNote(body), path: file }
	const problem = updateNotesIndex(cwd, paths, (entries) => [...entries.filter((e) => e.path !== file), entry])
	if (problem) {
		return fail(problem)
	}
	return wrote(
		`Note '${slug}' ${existing === undefined ? "created" : w.op === "append" ? "appended to" : "replaced"}.`,
		file,
		`Indexed in ${paths.projectMd}. The body is NOT injected into your context — read_file it when you work in this area.`,
	)
}

function readNote(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf8")
	} catch {
		return undefined
	}
}

function updateNotesIndex(
	cwd: string | undefined,
	paths: AdsumPaths,
	edit: (entries: NoteIndexEntry[]) => NoteIndexEntry[],
): string | undefined {
	const entries = edit(parseNotesIndex(readProjectMd(cwd)))
	const result = writeProjectMdSection(cwd, NOTES_SECTION_ID, renderNotesIndexBody(entries))
	return sectionResultMessage(result, NOTES_SECTION_ID, paths.projectMd)
}
