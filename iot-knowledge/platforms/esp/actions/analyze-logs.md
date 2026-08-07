---
id: adsum/esp/actions/analyze-logs
title: "Action: Analyze Device Logs"
type: action
version: 1.0.0
owner: adsum-core
author: Omar Morceli
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: esp
---

# Action: Analyze Device Logs (actions/analyze-logs.md)

## When Used
Called from: Debug Loop's Analyze phase, Log Analyzer — immediately after any `capture-logs.md` capture
(`action="monitor"`). Per `rules/skill-loading.md`, capture without analysis is an unfinished operation;
never end a turn at "logs captured."

## Pre-conditions
- A log file exists on disk under `logs/uart/` (the absolute path the capture step returned).
- You know the current symptom terms — what the user reported, or what the workflow is checking for
  (a component tag, an error code, a Wi-Fi/BLE event, a reset reason).

## How — Search First, Read Second

**Rule 1 — Do NOT `read_file` a freshly captured log in full as your first move.** A boot + run capture can
run to thousands of lines before the actual failure; a blind full read burns context finding nothing.

**Rule 2 — `search_files` the log's directory FIRST**, one regex combining the generic failure vocabulary
with the current symptom's own terms:
```
search_files: path="logs/uart", regex="error|panic|assert|fault|Guru Meditation|Backtrace|abort\(\)|<symptom term>"
```
- Always include: `error`, `panic`, `assert`, `fault`, `Guru Meditation`, `Backtrace`, `abort()`.
- Add symptom terms to the same `|`-joined regex — one search, not several round-trips.
- Point `path` at the capture's **directory** (`logs/uart`), not a single filename — multiple boards or
  repeated captures are covered in one pass.

**Rule 3 — Read only what the search told you to read.** `read_file` a line range around a hit (or the
whole file if the search came back thin). Do not re-read what the search already showed you.

**Rule 4 — Oversized reads come back folded, not blind-truncated.** A `read_file` over the size threshold
returns the head, the tail, and every line matching the error vocabulary from the dropped middle — the
full file stays untouched on disk at the path you already have. Don't fight the fold or ask the user for
the raw file; if it's missing something specific, `search_files` for that instead of re-reading.

## ⚠ The Silent-Zero Trap (verified)

**`search_files` with a `file_pattern` argument against a gitignored directory can silently return 0
matches.** `logs/` is gitignored by default — pairing `file_pattern` with a gitignored path is the failure
mode. The tool reports success with zero hits, which reads as "the log is clean" when it actually means
"the search never looked."

**Fix: search the log directory directly, and do NOT pass `file_pattern`.**
```
✗ search_files: path="logs/uart", regex="panic", file_pattern="*.log"   ← can silently return 0
✓ search_files: path="logs/uart", regex="panic"                          ← searches every file in the dir
```
Never trust a 0-match result from inside `logs/` when `file_pattern` was set — re-run the identical search
without it before concluding the log is clean.

## Output
Report findings against the log evidence you actually found (hit lines + surrounding context) — not
against the folded/truncated view alone. Cite the log's absolute path so the user can open it directly.
