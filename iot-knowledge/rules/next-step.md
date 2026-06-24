---
id: adsum/rules/next-step
title: "Productive Next-Step Loop"
type: knowledge
version: 0.1.3
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: universal
created: "2026-06-22"
updated: "2026-06-24"
status: draft
---

# Productive Next-Step Loop (rules/next-step.md)

How a workflow ends: not a generic "what next?", but the single highest-value action **grounded in what the
run already computed** — offered once, decline-able, in the developer's voice, then looped until the value
runs out. **Goal: keep the developer productively engaged only as long as it stays productive.** Retention is
a byproduct of usefulness, never the target. The calling workflow supplies the **candidate source** and
labels each candidate **pre-computed** or **reasoned** (below).

## The cycle
finish the workflow → gather the candidates the run already produced → ground each in a cited fact → rank by
value/severity → if the top clears the bar, make **one** concrete, decline-able, dev-as-hero offer → the dev
decides → do it in-session → re-derive from the **new** state → … → exit when the high-value backlog is dry
or the dev says "done".

## Rules (each fixes a real failure mode)
1. **No free generation — and be precise which source auto-loops.**
   - **Pre-computed (the ONLY auto-looped source):** a finite, evidence-bounded list the run already produced
     (for CRA: the posture's Kconfig gap list). The model only *surfaces + ranks* these — never invents one.
   - **Reasoned (allowed ONCE, never loops):** a finding the model gets by reading source (e.g. a real bug).
     It may headline **once**, **integrity-guarded** — quote the literal evidence and frame it "I don't see
     `X()` — verify", **never an asserted bug** — and route into `debug`/`addFeature`. It must NOT seed the loop.
2. **Headline + grounded backlog.** Lead with the single most striking grounded insight, then the ranked,
   evidence-cited list so the dev sees everything and chooses. Every line is **evidence-mode**: a literal fact
   + "verify", never an assessed verdict ("debug port is open" is a verdict — say "`CONFIG_NRF_APPROTECT_LOCK`
   not present in your merged `.config` — if you need it closed in production, verify").
3. **Rank by value/severity (dependency tie-break).** A real bug or a ship-blocking exposure is usually the
   bigger win, but do **not** hard-rank "bridge-to-core" above all compliance gaps — a ship-blocker must not
   sort below a minor bug.
4. **Offer-time re-verify is MECHANICAL.** After ANY applied change, **regenerate the candidate list from the
   live evidence** (re-read the merged `.config`); the offer pool = regenerated gaps **minus accepted**; never
   offer from the pre-action list, never rely on a second prose re-read. (Offering a fix the dev just applied
   is the worst trust-killer after lying.)
5. **Deterministic exit — and these are the ONLY two exits.** Exit when **(a)** the pre-computed gap list is
   empty (every high-value gap applied or explicitly skipped by the dev), **OR (b)** the dev declines / says
   "done". **Nothing else ends the loop.** Applying the ONE fix the dev picked is **NOT** an exit — re-derive
   the gap list (rule 4) and offer the next one. The **preview / bundled-sample path is NOT an exit** (on a
   sample the dev still gets to pick the next gap). "The remaining gaps are for the dev to apply", "the report
   is written", "they seem satisfied" are **NOT** exits. **While ≥1 high-value gap remains AND the dev hasn't
   declined, your next move is another decline-able offer — never `attempt_completion`, never the completion
   marker.** *Listing* the remaining gaps inside a completion is not offering them. (Two real runs ended after
   one fix with three gaps merely listed — that exact slip is what this rule exists to stop.) The reasoned
   class is unbounded, so it can never govern the exit. No streaks, no nags, no "you're 1 step from compliant".
6. **Honesty grammar on the offer AND the closing summary.** Banned verdict words (compliant / certified /
   passes / affected / fixed / done / resolved / clear) — in the offer sentence and the sign-off, not just the
   report body. "started — build, flash, verify", never "fixed". Dev-as-hero ("want me to start X so YOU can
   verify?", never "I secured it").
7. **One offer XOR the menu.** When a grounded offer fires, the generic next-step menu is suppressed — never a
   sharp offer followed by a generic grid. The menu is the fallback only when nothing was groundable. The
   generic menu is the **host's** `NextStepChooser`, rendered on the workflow's completion marker — **don't
   print a text menu yourself**; at loop-exit emit the workflow's completion marker and the host shows it.

## Remediation execution (when the dev accepts a fix)
The loop's "do it in-session" step — apply the change **cleanly**, then re-derive (rule 4). Discipline that
keeps a landed fix trustworthy:
- **Leave only the working change.** If you tried approaches that didn't work, **revert them** before the
  handoff — never leave dead-end edits (a stray `rsource`, a redundant force, a now-wrong comment) in the
  dev's tree. The handoff records the **precise final diff**, not the path you took to it.
- **Regenerate from the NEW state — ALL artifacts, not just the gap list.** Rule 4 re-reads the merged
  `.config`; additionally, **if the change altered the component set** (added/removed an image or library —
  e.g. a bootloader, a crypto lib), **re-run the SBOM step** so the SBOM describes the *built* firmware, **and
  rewrite the written report** (`CRA_READINESS.md` + `cra-readiness.json`) so its posture rows + SBOM section +
  gap list reflect the **post-fix** state. Never ship a pre-fix posture ("not built") beside a post-fix SBOM
  ("3-image incl. mcuboot") — that self-contradiction in the deliverable is the worst trust-killer after lying.
- **Prefer the project's existing setup.** Before hand-rolling, check for the project's own config for this
  feature (a staged `*.conf`, `sysbuild.conf`, `pm_static.yml`). If present, wire or **offer that** (or ask
  which flavour the dev wants) — don't silently invent a different one.
- **Depth guard — don't churn.** If a fix needs unfamiliar build-system surgery or more than ~1–2 failed
  build iterations, **stop**: hand back to the dev (or route into `addFeature`) with what you learned, rather
  than burning the session rebuilding.
- **Handoff honesty (extends rule 6) — applies to EVERY summary, not just the table.** The handoff is
  **"changed — build, flash, verify"**. A clean build is **not** verification — never "✅ Built & verified",
  "✅ done", "gaps addressed", or **any status glyph (✅ / ⚠️ / ❌) as a marker** — not in the report, the
  remediation log's session summary, **or the final completion message** (the model has slipped `✅ Built` into
  the closing recap even when the table was clean). State outcomes + the **change-impact caveat** (a new
  bootloader changes the flash layout / partition map; a default signing key is a debug key) in **words**.

## Degradation (stay honest cross-context)
If the candidate source is empty or unavailable — the developer chose the **SBOM-only** branch (no posture
ran), the posture found no gaps, or no build exists to read — yield to the plain bridge offer (`debug` /
`addFeature`) or the generic menu — **never fabricate a candidate**. (Both nRF and ESP produce a posture gap
list when the posture step runs, so this is about *whether* posture ran, not which platform.)
