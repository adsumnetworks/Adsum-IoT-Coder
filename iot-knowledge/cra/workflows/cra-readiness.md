---
id: adsum/cra/workflows/cra-readiness
title: CRA SBOM & Fix
type: workflow
version: 0.2.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: cra
platform: universal
triggers:
  - CRA
  - SBOM
  - fix vulnerability
  - CRA readiness
  - CRA SBOM
  - get CRA-ready
requires:
  - adsum/nrf/actions/cra-generate-sbom
  - adsum/esp/actions/cra-generate-sbom
  - adsum/nrf/rules/cra-posture
  - adsum/esp/rules/cra-posture
  - adsum/nrf/sdks/ncs/cra-advisories
  - adsum/esp/sdks/esp-idf/cra-advisories
  - adsum/rules/next-step
created: "2026-06-18"
updated: "2026-06-22"
status: draft
---

# CRA SBOM & Fix (cra/workflows/cra-readiness.md)

**Triggered by:** "CRA", "SBOM", "fix vulnerability", "CRA readiness", "get CRA-ready".

Lead with the **SBOM** — the CRA's named machine-readable artifact, generated from the developer's real
build (the reliable hero "door"). Then offer to go further: a secure-by-design **posture preview** and help
to *start* closing the top gap (the "spine"), and a **bridge** into the everyday agent (debug / add-feature)
for whatever's most valuable next. Works on nRF (NCS/Zephyr) and ESP (ESP-IDF).

> **This is a readiness aid, not a conformity assessment, and not legal advice.** It helps a manufacturer
> *prepare*. It never says "compliant", "certified", "passes", or "affected". It reports your build's
> literal evidence + what to verify — the conclusion is yours. Only a notified body / your formal
> assessment establishes conformity.

## Steps

1. **Disclaimer first.** State the boundary above in one line before doing anything.

2. **Detect the platform & project, and resolve where artifacts go (before writing anything).**
   Use the existing environment detection (nRF Connect / ESP-IDF, board, SDK version).
   - **The user's OWN firmware project is the open workspace root** → write to `<workspace-root>/compliance/`
     (its natural home, version-controllable next to the code). No need to ask.
   - **The bundled sample, OR no project open** → **always the preview path.** The bundled sample is
     structurally a valid project (`CMakeLists.txt`/`prj.conf`/`src/`) but it is **ours, not the user's**,
     and in a published build it lives **read-only inside the extension** — so **NEVER write a `compliance/`
     into the bundled sample's directory or anywhere inside the extension/`demo-scenarios` tree**, and never
     into a bare cwd like the Desktop (it litters + breaks checkpoints). Present the report **inline in
     chat**, then **ask** via `ask_followup_question` whether to save — and only if yes, write to a
     **namespaced**, OS-appropriate folder you propose under the user's home/Desktop (e.g.
     `~/Desktop/adsum-cra-<sample>/compliance/`; Windows `%USERPROFILE%\Desktop\adsum-cra-<sample>\compliance\`).
     Always state the absolute output path. **On preview-and-ask, nothing is written until the user consents.**
   - **If no project is open**, you cannot check the user's code yet — and **opening a folder reloads VS Code,
     which ends this chat.** So NEVER offer "open it and I'll continue." Offer a button choice via
     `ask_followup_question`:
     - **"Run on the bundled nRF sample"** → shipped **read-only** at `<extension-root>/demo-scenarios/nus-uart/central_uart`
       (the `demo-scenarios/` sibling of the `iot-knowledge/` dir these skills load from; derive
       `<extension-root>` from the absolute path you read THIS workflow from). **Read it in place; NEVER modify
       it or write inside it.** Build to an **OS temp** dir (`west build -d <tmp-dir>`), and follow the save
       rule above. State plainly the result describes the *sample* — for their own product they run it on their code.
     - **"Check my own project"** → **instructions only** (don't wait to continue): *"Open your firmware
       project (File ▸ Open Folder — VS Code reloads), then click the **CRA SBOM & Fix** card again."*

3. **SBOM — the door. MANDATORY SKILL LOAD.**
   - nRF project → `read_file` → `platforms/nrf/actions/cra-generate-sbom.md`
   - ESP project → `read_file` → `platforms/esp/actions/cra-generate-sbom.md`
   Run it; write the SPDX output under `compliance/sbom/` (real project) or show it inline (preview path).
   This is the CRA's named machine-readable artifact (Annex I, Part II). The action's `Method:` records which
   tool actually ran (`west ncs-sbom` / `west spdx` / SBOM-lite — never mislabel SBOM-lite as SPDX).

4. **Branch — let the developer choose how far to go.** After the SBOM lands, offer via
   `ask_followup_question`:
   - **"Just the SBOM"** → write/show the SBOM + a one-line "here's your CRA SBOM; re-run any time for the
     posture preview." Skip to the bridge (step 6) with the SBOM as the grounded artifact. (A complete,
     useful outcome on its own — never force the rest.)
   - **"Continue — posture preview + start fixing"** → steps 5–6.

5. **Secure-by-design posture preview + remediation spine. MANDATORY SKILL LOAD.**
   - nRF → `read_file` → `platforms/nrf/rules/cra-posture.md`; evidence = the merged `build/<target>/zephyr/.config`.
   - ESP → `read_file` → `platforms/esp/rules/cra-posture.md`; evidence = `build/config/sdkconfig.json` (or `sdkconfig`).
   Report each row as **Requirement (curated, sourced to the CRA regulation) · Your build shows (literal) ·
   You verify** — **evidence-mode, no ✅/⚠️/❌.** Then a **dependency-ordered** "worth doing now" list (e.g.
   secure boot before signed updates). Label it **"Building toward the 11 Dec 2027 essential cybersecurity
   requirements (CRA Annex I, Part I) — worth doing now."** Both platforms are at parity (the checks differ
   by chip — nRF reads NCS/Zephyr Kconfig, ESP reads ESP-IDF Kconfig).
   - **Obligation context (curated-static, one line — NOT a blocking gate, NOT a verdict):** state the
     conformity route in our words, sourced to the public regulation: *"Most connected products self-assess
     (Module A); important/critical classes need a Notified Body or EU certification — confirm your product's
     class."* Default the **binding date** to the non-alarming **11 Dec 2027** (full obligations) and label it
     **"assumed — confirm for your real product."** Only if the developer volunteers that the product is
     **already on the EU market** note that **Article 14 vulnerability/incident reporting applies since
     11 Sep 2026** (24h/72h/14-day) — the literal trigger, not a judgement; operational incident reporting is
     a separate paid Adsum capability. **NEVER assume market status.**
   - **Advisories (bonus) — MANDATORY SKILL LOAD.** nRF → `read_file` → `platforms/nrf/sdks/ncs/cra-advisories.md`;
     ESP → `read_file` → `platforms/esp/sdks/esp-idf/cra-advisories.md`. Surface the bundled advisories for the
     detected SDK version with links + an "as of <date>; check live for newer" note. **Surface-and-link ONLY —
     never an affected/not-affected verdict, and NEVER auto-populate from a scanner / `esp-idf-sbom check` /
     NVD / any network source at runtime** (advisories are authored at build time). If empty, surface the
     live-source links and say "no bundled advisories for <sdk> <ver> as of <date>; check live" — never imply
     the project is therefore clear. This populates report section 3 on both platforms.

6. **Bridge — the productive next step. MANDATORY SKILL LOAD.** `read_file` → `rules/next-step.md` and follow
   it. Candidate source for this workflow: the posture's **finite, evidence-grounded Kconfig gap list**
   (pre-computed) — surface the highest-value one as a single concrete, decline-able, dev-as-hero offer, then
   loop per `next-step.md` (regenerate the gap list from the live `.config` after each applied change; offer
   pool = gaps minus accepted; stop when the high-value backlog is dry). A real bug you *read* in the source
   may headline **once**, integrity-guarded ("I don't see `X()` — verify", never an asserted bug), routed into
   `debug`/`addFeature` — it does not seed the loop. **One grounded offer XOR the generic menu.**
   - **Remediation handoff (when you start/apply a fix).** Write/append `compliance/cra-remediation-<date>.md`
     recording the change you're starting — the component/Kconfig symbol, what changes, the advisory link if
     any — framed **"changed — build, flash, verify"**, never "fixed". This is the developer's record of what
     was started (and the host's signal that the remediation spine reached its handoff). On the preview-and-ask
     path, show it inline until the user consents to save.

7. **Write the artifacts** (real project → `<project-root>/compliance/`; sample → only after the user says
   save, into the namespaced folder you proposed — otherwise show inline and skip the write). Write **all**
   outputs and tell the user the absolute path.
   - `compliance/sbom/…` — the SBOM from step 3 (SPDX, or the SBOM-lite markdown). A real folder, not inlined.
   - `compliance/CRA_READINESS.md` — exact filename; fill the skeleton below.
   - `compliance/cra-readiness.json` — the same results, machine-readable. Emit the JSON too, not only the `.md`.
   *(On the preview-and-ask path these `.md`/`.json` files are written only after consent — otherwise the
   report is inline-only.)*

   **Report skeleton (fill it; don't free-form — the parts below are the ones agents drop):**
   ```
   # CRA SBOM & Fix — <project>
   > Readiness aid — NOT a conformity assessment, NOT legal advice. Reports your build's literal evidence +
   > what to verify; the conclusion is yours. Only a notified body / your formal assessment establishes conformity.
   > Product type: <answer | assumed> · Market status: <answer | assumed — confirm> · Binding date: <11 Dec 2027 | Art. 14 since 11 Sep 2026>
   > SDK: <version + how resolved> · Generated: <date> · Method: <west ncs-sbom | west spdx | SBOM-lite>

   ## 1. SBOM            → see compliance/sbom/ (summarise; don't paste the whole inventory)
   ## 2. Posture preview → the step-5 table: Check · Requirement (sourced) · Your build shows (literal) · You verify
   ## 3. Advisories      → MANDATORY section even when empty: the live-source links + "no bundled advisories
                            for NCS <x> as of <date>; check live" (never silently omit it)
   ## 4. Worth doing now → dependency-ordered gap list (step 5)
   ```
   **Before you finish, check:** disclaimer + binding date are in the **written header** (not just chat) ·
   the posture table is **evidence-mode** (Requirement · Your build shows · You verify — **no ✅/⚠️/❌**) · the
   advisory section is present · **both** `CRA_READINESS.md` **and** `cra-readiness.json` were written (real
   project / after consent) · `compliance/sbom/` exists.

## Honesty rules (cross-cutting essentials — posture-specific detail lives in the posture bit)
- Real evidence per row or "unknown" — never invent a finding.
- **Evidence-mode, never a verdict.** Report the literal config fact + "verify this"; never grade a row
  (Strong / Weak / Pass / ✅ / ❌) and never write the product "meets / satisfies" a requirement — the
  conclusion is the developer's. **Verify the positive AND the negative:** don't narrate a feature present
  when its named symbol shows `not set` (regardless of adjacent symbols, and confirm multi-image bootloaders
  were actually built — not just requested in `prj.conf`), nor absent when it's there. **This re-read is the
  load-bearing guard — a citation never makes a misread safe.** (Full rule in the posture bit; a real run
  fabricated "SMP off" with SMP on, another stamped secure boot present with MCUboot not set.)
- Never say "compliant", "certified", "passes", "affected / not affected".
- **Curated-static citations only:** state the source at **Part I / Part II** exactly as written in the
  posture bit (fixed, copied labels — never selected or invented); **nothing finer** (no clause letters /
  article numbers — guessed ones reopen a known failure). Vendor docs cited only as a generic "see also".
- **Never write "fixed" / "done" / "resolved" / "✅ FIXED"** — in the header, table, chat, **or the closing
  summary** (the model has slipped "Top gap fixed" into the sign-off even with a clean table). A change you
  applied is **"started (Kconfig added) — you must build, flash, and verify"**; a clean build is not verification.
- **Integrity guard for a fix you start:** it must close a **real, evidenced** gap — if, on opening the code,
  the setting was already there, **say so and stop** (don't invent a rationale to edit anyway); change **only**
  what the gap needs; the row + chat stay "started — unverified".
- **On the bundled sample, NEVER modify it — you'd see the diff only, it's never edited** (read-only, ours;
  the write-guard enforces this). The user owns the result.

## Next step
The bridge (step 6) drives this via `rules/next-step.md` — a single grounded, decline-able offer, then the
loop, then a clean exit. **No project:** see step 2 — run on the bundled sample, or give the open-then-re-click
instructions. **Never** promise to "continue after you open a project" (the reload ends the chat).

## Completion marker (emit ONLY at loop-exit — this drives the funnel + the fallback menu)
When the next-step loop has **exited** — its high-value backlog is dry, or the developer declined / said
"done" — end your **final** message with `<!--TASK_COMPLETE-->` (exactly — nothing after it). This signals
the host (funnel telemetry + the generic next-step menu, which is the **post-exit fallback**). **Do NOT emit
it while a grounded offer is still pending** (an `ask_followup_question` offer keeps the task active — that's
the in-chat path; the marker is for *after* the loop). One offer XOR the menu: don't also print a generic
text menu — the host renders the menu on completion.
