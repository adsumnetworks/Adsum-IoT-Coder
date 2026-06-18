---
id: adsum/nrf/actions/cra-generate-sbom
title: Generate SBOM (nRF / west spdx)
type: action
version: 0.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
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
Two gotchas are the whole value: (1) `west spdx --init` **must run before the build** (it enables the
CMake file-based API), and (2) the build **must have `CONFIG_BUILD_OUTPUT_META=y`** or `west spdx`
errors *"CONFIG_BUILD_OUTPUT_META must be enabled to generate spdx files."* Run via the nRF device tool.

1. `west spdx --init -d <build_dir>`   ← BEFORE building (enables the CMake file-based API)
2. `west build -d <build_dir> … -- -DCONFIG_BUILD_OUTPUT_META=y`   ← build with build-meta ON (long-running).
   Equivalently add `CONFIG_BUILD_OUTPUT_META=y` to the project. **Without it, step 3 fails** — that is the
   single most common `west spdx` failure.
3. `west spdx -d <build_dir>`           ← emits `<build_dir>/spdx/{app,zephyr,build}.spdx`
4. Copy the `*.spdx` into `compliance/sbom/`.

If a build already exists but was made **without** `--init` (or without `CONFIG_BUILD_OUTPUT_META`), offer a
user-confirmed pristine rebuild with both (builds are long — see AGENT.md permissions).

> **Sysbuild gotcha — don't loop.** On **sysbuild** projects (the nRF default), `west spdx` often still fails
> with *"cmake api reply directory …/.cmake/api/v1/reply does not exist"* even after `--init` + a clean
> rebuild — the file-based API query dir isn't created inside the image sub-build. Try the golden path **once**;
> if you hit that error, **stop and use the SBOM-lite fallback** — don't burn rebuilds chasing it.

## Fallback (SBOM-lite)
If `west spdx` is unavailable / fails (e.g. the sysbuild case above), fall back to `west list` → a markdown
component inventory written to `compliance/sbom/`, with the **exact** heading **"SBOM-lite (component
inventory, not SPDX)"** so no one mistakes it for the CRA's named SPDX artifact.
- **Reconcile the version before you write it.** `west list` reports the **west workspace/manifest**
  revisions, which can differ from what the build actually consumed. Cross-check against the build's
  `<build>/<image>/zephyr_modules.txt` module paths (e.g. `/opt/nordic/ncs/v3.3.1/…`). **If they disagree on
  the NCS version, say so** ("west workspace = v3.2.1, build linked v3.3.1 modules — verify") rather than
  stamping one version across the whole inventory.

## Safety
`shell` (runs `west`), `long-running` (the build). No flash/erase.

> ⚠️ **VERIFY ON HARDWARE before launch:** confirm the exact `west spdx --init/-d` flags + output paths on
> **NCS 3.2.1** (flags have drifted across versions). Version-gate this action if needed.
