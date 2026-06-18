---
id: adsum/cra/workflows/cra-readiness
title: CRA Readiness Check
type: workflow
version: 0.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: bundled
domain: cra
platform: universal
triggers:
  - CRA
  - CRA readiness
  - CRA Readiness Check
  - readiness check
  - get CRA-ready
requires:
  - adsum/nrf/actions/cra-generate-sbom
  - adsum/esp/actions/cra-generate-sbom
  - adsum/nrf/rules/cra-posture
  - adsum/esp/rules/cra-posture
  - adsum/nrf/sdks/ncs/cra-advisories
created: "2026-06-18"
status: draft
---

# CRA Readiness Check (cra/workflows/cra-readiness.md)

**Triggered by:** "CRA", "CRA readiness", "readiness check", "get CRA-ready".

Produce a build-time **CRA readiness snapshot** into a `compliance/` folder: the software
bill of materials (SBOM), a secure-by-design posture preview, and a dated advisory list —
then offer to *start* fixing the top gap. Works on nRF (NCS/Zephyr) and ESP (ESP-IDF).

> **This is a readiness snapshot, not a conformity assessment, and not legal advice.** It helps a
> manufacturer *prepare*. It never says "compliant", "certified", "passes", or "affected". A ✅ means
> "configured/present", never "correct/done". Only a notified body / the manufacturer's formal
> assessment establishes conformity.

## Steps

1. **Disclaimer first.** State the boundary above in one line before doing anything.

2. **Obligation check (10 seconds).** Ask the developer two questions via `ask_followup_question`:
   - "Is this product **already placed on the EU market** (sold/shipped)?"
   - "What type is it — a normal connected product, or an *important/critical* class (e.g. smart lock, router, security product)?"
   Resolve the **binding date** and write it into the report header:
   - **Not yet on the market →** your binding date is **11 Dec 2027** (full obligations). "This free check is your head start."
   - **Already shipping →** **11 Sep 2026 Article 14 reporting already applies to you** (report actively-exploited vulnerabilities / severe incidents in 24h/72h/14-day). Note that operational incident reporting is a separate, paid Adsum capability — this free check covers build-time readiness.
   *(Low-liability: "already on the market" is the literal Article-14 trigger, not a judgement.)*
   **NEVER assume the answer.** If the user hasn't confirmed market status, you have NOT established it — do not assert "already on the market" or "Article 14 active." When running on the **bundled sample**, a sample is by definition not a shipped product: default to **not yet on market → 11 Dec 2027**, and label the header's market status **"assumed — confirm for your real product."** Pick the *non-alarming* default, never the Article-14 one, without a user answer.

3. **Detect the platform & project.** Use the existing environment detection (nRF Connect / ESP-IDF, board, SDK version).
   **Resolve where artifacts go (do this before writing anything):**
   - **A real firmware project is open** → write to `<project-root>/compliance/` (its natural home, version-controllable next to the code). No need to ask.
   - **No project / bundled sample** → the workspace cwd may be a non-project folder (e.g. the Desktop) where a bare `compliance/` litters and checkpoints fail. So treat it as a **preview**: present the full report **inline in chat**, then **ask** via `ask_followup_question` whether to save — and if yes, write to a **namespaced** folder you propose (e.g. `~/Desktop/adsum-cra-<sample>/compliance/`), never a bare `compliance/` in a non-project directory. Always state the absolute output path.
   **If no project is open**, you cannot check the user's code yet — and **opening a folder reloads VS Code, which ends this chat.** So NEVER offer "open it and I'll continue" (that promise can't be kept). Offer a button choice via `ask_followup_question`:
   - **"Run on the bundled nRF sample"** → run the full check in-place on the shipped sample (no reload). State plainly that the result describes the *sample* — it shows how the check works; for their own product they run it on their code.
   - **"Check my own project"** → respond with **instructions only** (do not wait to continue): *"Open your firmware project (File ▸ Open Folder — VS Code will reload), then click the **CRA Readiness Check** card again and I'll run it on your code."*

4. **SBOM — MANDATORY SKILL LOAD.**
   - nRF project → `read_file` → `platforms/nrf/actions/cra-generate-sbom.md`
   - ESP project → `read_file` → `platforms/esp/actions/cra-generate-sbom.md`
   Run it; write the SPDX output under `compliance/sbom/`. This is the CRA's named machine-readable artifact (Annex I, Part II).

5. **Secure-by-design posture — MANDATORY SKILL LOAD (the spine).**
   - nRF → `read_file` → `platforms/nrf/rules/cra-posture.md`
   - ESP → `read_file` → `platforms/esp/rules/cra-posture.md`
   Evaluate each check against **real build evidence** (nRF: the merged `build/zephyr/.config`; ESP: `sdkconfig`), produce a status (✅ / ⚠️ review / ❌ missing) + the **plain-English requirement** + a suggested action. Then a **dependency-ordered** "do these first" list (e.g. secure boot before signed updates). Label the section: **"Building toward the 11 Dec 2027 essential requirements — worth doing now."**

6. **Advisory bonus (nRF, when any exist) — MANDATORY SKILL LOAD.** `read_file` → `platforms/nrf/sdks/ncs/cra-advisories.md`. Surface the known advisories for the detected SDK version with links + an "as of <date>; check live for newer" note. **Surface-and-link only — never an affected/not-affected verdict.** (ESP advisories are a fast-follow.)

7. **Write the artifacts** into the output directory resolved in step 3 (a real project → `<project-root>/compliance/`; a sample → only after the user says save, into the namespaced folder you proposed — otherwise show them inline and skip the write). Always tell the user the absolute path you wrote to.
   - `compliance/sbom/…` (SPDX from step 4)
   - `compliance/CRA_READINESS.md` — header (disclaimer + binding date), posture table, advisory list, "do these first"
   - `compliance/cra-readiness.json` — the same results, machine-readable (pre-wires the future register)

8. **Help you *start* the top fix — in dependency order.** Offer, via `ask_followup_question`, to *begin* closing the top gap (e.g. "Want me to start adding MCUboot secure boot?") — route into the existing add-feature workflow. Offer gaps in **dependency order**, not just severity. Framed as **help you start** — never "fixed" / "now compliant"; the user owns the result.

## Honesty rules
- Real evidence per row or "unknown" — never invent a status.
- A heuristic finding is "⚠️ review", never "❌ violation". A ✅ is "configured/present", never "correct/done".
- Never say "compliant", "certified", "passes", "affected/not affected".

## Next step
Offer the developer a button choice via `ask_followup_question` — never "type this".
- **With a project:** start the top fix (step 8), or re-run the check.
- **No project:** see step 3 — run on the bundled sample, or give the open-then-re-click instructions. **Never** promise to "continue after you open a project" (the reload ends the chat).
