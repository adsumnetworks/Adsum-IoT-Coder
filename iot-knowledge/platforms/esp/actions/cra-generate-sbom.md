---
id: adsum/esp/actions/cra-generate-sbom
title: Generate SBOM (ESP / esp-idf-sbom)
type: action
version: 0.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: bundled
domain: cra
platform: esp
sdk: esp-idf
safety:
  - shell
  - long-running
created: "2026-06-18"
status: draft
---

# Generate SBOM — ESP / esp-idf-sbom (platforms/esp/actions/cra-generate-sbom.md)

## What it does
Emits a machine-readable **SPDX** SBOM for an ESP-IDF project — the cross-vendor counterpart to the nRF
door, so the ESP cohort isn't dead-ended. The CRA's named artifact (Annex I, Part II).

## Golden path — esp-idf-sbom create (vendor-native, local, offline)
Espressif's `esp-idf-sbom` generates SPDX from a real build. **Use the `create` subcommand only** — it is
local and offline. Run via the ESP-IDF env.
1. **Install (not bundled with ESP-IDF):** `pip install esp-idf-sbom` if it's absent.
2. **Build first** (`idf.py build`) so `build/project_description.json` exists. If it's missing, say
   "build first" — don't error.
3. **Generate:** `esp-idf-sbom create build/project_description.json -o compliance/sbom/<app>.spdx`.
   Output is **SPDX 2.2 only** — it does **not** produce CycloneDX; never claim a format it can't emit.
4. **Spaces in the project path** break CMake/IDF configure the same way as on nRF — stage the project to
   a space-free temp dir before building (the install path may contain spaces).

> 🚫 **MISSION-EXIT FENCE — run `create` ONLY.** NEVER run `esp-idf-sbom check`, `sync-db`, or
> `manifest check`: they query the **NVD network feed** (`nvd.nist.gov`) and ARE the live-CVE /
> SBOM-to-CVE-matching service we deliberately do not build or depend on. The `--local-db` /
> `--no-sync-db` flags are a false "offline" escape hatch — they still require an initial NVD sync and
> still emit affected/not-affected **verdicts**. Advisories are **surface-and-link only**, never a CVE
> verdict (that's the higher-liability, out-of-scope layer).

## Fallback (SBOM-lite)
If `esp-idf-sbom create` genuinely can't run after the steps above, fall back to a markdown component
inventory built from the project's **real** dependency sources — `dependencies.lock`, the
`managed_components/` tree, and the `idf_component.yml` graph — written to `compliance/sbom/` under the
**exact** heading **"SBOM-lite (component inventory, not SPDX)"** so no one mistakes it for the CRA's
named SPDX artifact. Never dead-end the ESP user — always produce *something* + the honest label.

## Safety
`shell` (runs `idf.py` / `esp-idf-sbom create`), `long-running` (the build). No flash/erase. **No
network** — `create` is offline; the network subcommands are fenced off above.

> ⚠️ **VERIFY ON HARDWARE before launch:** confirm the `esp-idf-sbom create` invocation, the `-o` output
> path, and the SPDX version on the **ESP-IDF the cohort runs** (`esp-idf-sbom` moves fast — v1.1.0
> shipped 2026-06-10; version-pin or re-verify `create`). Gate to SBOM-lite if unavailable.
