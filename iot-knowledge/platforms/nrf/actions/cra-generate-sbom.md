---
id: adsum/nrf/actions/cra-generate-sbom
title: Generate SBOM (nRF / west ncs-sbom)
type: action
version: 0.2.1
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: cra
platform: nrf
sdk: ncs
safety:
  - shell
  - long-running
requires:
  - adsum/nrf/actions/cra-generate-sbom-fallbacks
created: "2026-06-18"
updated: "2026-06-23"
last_verified: { date: "2026-06-23", env: "NCS 3.2.1 / nRF5340DK dual-core sysbuild" }
status: draft
---

# Generate SBOM — nRF / west ncs-sbom (platforms/nrf/actions/cra-generate-sbom.md)

## What it does
Emits a machine-readable **SPDX** software bill of materials from the **real** Zephyr/NCS build —
the CRA's named artifact (Annex I, Part II). SPDX is a commonly-used machine-readable format. Prefer
Nordic's vendor-native `west ncs-sbom` (the golden path below); only if it genuinely can't run, descend
the fallback ladder (a separate bit, loaded on demand only if the golden path fails).

## Golden path — west ncs-sbom (vendor-native, preferred)
Nordic's own SBOM tool (in NCS 2.0–3.3.x → 3.2.1 covered), positioned by Nordic for CRA. Over `west spdx`
it adds per-file **license detection**, **PURL/CPE** ids, package supplier, an **HTML report**, and handles
**sysbuild natively per-domain** — so the fragile `--init`/reply-dir dance is **not needed**. Output is
**SPDX 2.2** (`west spdx` is 2.3 — both CRA-acceptable; label which you produced in the report `Method:` field).
1. **Deps pre-flight (don't crash):** if `ncs-sbom` errors on a missing import, install its deps: `pip3 install -r <ncs>/nrf/scripts/requirements-west-ncs-sbom.txt`. Detect-and-instruct; never dead-end.
2. **Build** to a Ninja build dir: `west build -d build -b <board> .` (long-running). The **spaces-in-path** rule below applies — it builds the project like every rung does.
3. **Generate:** `west ncs-sbom -d build --output-spdx compliance/sbom/<app>.spdx --output-html compliance/sbom/sbom_report.html`.
   - **Sysbuild:** point `-d` at the **build root** — `ncs-sbom` reads `domains.yaml` and (on **NCS 3.2.1**, verified) emits a **single SPDX covering all domains** (app + net-core) at the path you give. **`{domain}` is NOT a placeholder on 3.2.1 — it's written literally; use a plain filename** (`compliance/sbom/<app>.spdx`). Newer `ncs-sbom` may fan out per-domain / expand `{domain}` — version-gate. **No `--init` dance.**
   - **Skip scancode** (long-running): pass `--license-detectors spdx-tag,full-text,external-file` (omit `scancode-toolkit`). There is **no `-n` flag** — don't invent one.
4. **License data = evidence-to-verify, not authoritative** — Nordic marks license detection **experimental**. Surface licenses as "detected — verify", never as a compliance fact (readiness-not-compliance).
5. `west ncs-sbom` **only generates** — no CVE/vulnerability scanning, so nothing to fence (advisories stay surface-and-link via the advisories bit).

## Spaces in the project path break the build — stage to a space-free dir
Zephyr/CMake devicetree preprocessing splits the `app.overlay` path on spaces, so a project under a path
like `…/Adsum IoT Coder/…` or `~/Desktop/My Project/` fails configure with *"fatal error: /…/Adsum: No
such file or directory"* — **even with the app dir quoted, and even via a symlink** (CMake resolves the
real path). Don't burn rebuilds fighting the quoting: **copy the project into a space-free temp dir**
(e.g. `cp -r <proj> /tmp/cra-src/<app>`) and build from there. The read-only bundled sample is already
copied for building — copy it into a **space-free** temp (the install path may contain spaces).

## If the golden path genuinely can't run — descend the ladder (on-demand)
Only after `west ncs-sbom` is unavailable (absent on this SDK version) or genuinely errors **after** the
deps pre-flight above: **MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/actions/cra-generate-sbom-fallbacks.md`.
It holds **Fallback A** (`west spdx` — the hardened `--init` + sysbuild reply-dir recipe) and **Fallback B**
(SBOM-lite via `west list`). **Do NOT read it on the golden path** — a normal `ncs-sbom` run never needs it.
Descend one rung at a time, and **record which rung actually ran** in the report `Method:` field — never
mislabel SBOM-lite as SPDX.

## Safety
`shell` (runs `west`), `long-running` (the build). No flash/erase. No network.

> **Golden-path flags verified on hardware (NCS 3.2.1 / nRF5340DK, 2026-06-23):** `west ncs-sbom -d
> <build-root> --output-spdx --output-html --license-detectors spdx-tag,full-text,external-file` ran clean on
> a real dual-core sysbuild. **Re-verify on other NCS versions** — flags + `{domain}` behaviour drift across
> releases (version-gate if needed). The Fallback A/B flags are verified inside the fallbacks bit.
