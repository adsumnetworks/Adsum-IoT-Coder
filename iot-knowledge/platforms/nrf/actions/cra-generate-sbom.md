---
id: adsum/nrf/actions/cra-generate-sbom
title: Generate SBOM (nRF / west spdx)
type: action
version: 0.1.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: cra
platform: nrf
sdk: ncs
safety:
  - shell
  - long-running
created: "2026-06-18"
status: draft
---

# Generate SBOM — nRF / west spdx (platforms/nrf/actions/cra-generate-sbom.md)

## What it does
Emits a machine-readable **SPDX** software bill of materials from the **real** Zephyr/NCS build —
the CRA's named artifact (Annex I, Part II). SPDX is a commonly-used machine-readable format.

## How to run it (golden path)
The ordering gotcha is the whole value: `west spdx --init` **must run before the build** (it enables the
CMake file-based API the SBOM needs). Run via the nRF device tool, not a raw shell.

1. `west spdx --init -d <build_dir>`   ← BEFORE building
2. `west build -d <build_dir> …`        ← normal build (long-running)
3. `west spdx -d <build_dir>`           ← emits `<build_dir>/spdx/{app,zephyr,build}.spdx`
4. Copy the `*.spdx` into `compliance/sbom/`.

If a build already exists but was made **without** `--init`, offer a user-confirmed pristine rebuild with
`--init` (builds are long — see AGENT.md permissions).

## Fallback (SBOM-lite)
If `west spdx` is unavailable on the project's NCS version, fall back to `west list` → a markdown component
inventory written to `compliance/sbom/`, **clearly labeled "SBOM-lite (component inventory, not SPDX)"**.

## Safety
`shell` (runs `west`), `long-running` (the build). No flash/erase.

> ⚠️ **VERIFY ON HARDWARE before launch:** confirm the exact `west spdx --init/-d` flags + output paths on
> **NCS 3.2.1** (flags have drifted across versions). Version-gate this action if needed.
