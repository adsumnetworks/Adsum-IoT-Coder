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
Emits a machine-readable SBOM for an ESP-IDF project — the cross-vendor counterpart to the nRF SBOM, so
the 16-Jun ESP cohort isn't dead-ended. The CRA's named artifact (Annex I, Part II).

## How to run it (golden path)
Espressif ships `esp-idf-sbom` (the `idf.py` SBOM tooling). Run via the ESP device tool / IDF env.

1. Ensure the project has been built (`idf.py build`) so component manifests resolve (long-running).
2. Generate the SBOM with `esp-idf-sbom` for the project (SPDX/CycloneDX) → write under `compliance/sbom/`.
3. Label the format produced (SPDX or CycloneDX — both are commonly-used machine-readable formats).

## Fallback (SBOM-lite)
If `esp-idf-sbom` isn't available in the project's IDF version, fall back to the IDF component/dependency
list → a markdown inventory in `compliance/sbom/`, labeled **"SBOM-lite (component inventory)"**. Do not
dead-end the ESP user — always produce *something* + the honest label.

## Safety
`shell` (runs `idf.py`/`esp-idf-sbom`), `long-running` (the build). No flash/erase.

> ⚠️ **VERIFY ON HARDWARE before launch:** confirm the exact `esp-idf-sbom` invocation + install path on the
> **current ESP-IDF** (it may need `pip install esp-idf-sbom` or ships with IDF depending on version).
> Confirm the output format + path. Gate to SBOM-lite if unavailable.
