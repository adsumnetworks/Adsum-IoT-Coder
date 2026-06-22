---
id: adsum/nrf/actions/cra-generate-sbom
title: Generate SBOM (nRF / west ncs-sbom)
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

# Generate SBOM — nRF / west ncs-sbom (platforms/nrf/actions/cra-generate-sbom.md)

## What it does
Emits a machine-readable **SPDX** software bill of materials from the **real** Zephyr/NCS build —
the CRA's named artifact (Annex I, Part II). SPDX is a commonly-used machine-readable format. Prefer Nordic's vendor-native `west ncs-sbom`; fall back only when it can't run.

## Tool ladder — prefer the vendor-native tool, never dead-end
1. **`west ncs-sbom`** (Nordic, vendor-native) — richer + CRA-positioned; the **golden path** below.
2. **`west spdx`** (upstream-generic) — **Fallback A**, the hardened recipe; only if `ncs-sbom` is unavailable or genuinely fails.
3. **SBOM-lite** (`west list` inventory) — **Fallback B**, true last resort.
Descend only after the rung above genuinely fails, and **record which rung ran** in the report `Method:` field.

> The build gotchas (**spaces-in-path**, below) apply to every rung — they all build the project.

## Golden path — west ncs-sbom (vendor-native, preferred)
Nordic's own SBOM tool (in NCS 2.0–3.3.x → 3.2.1 covered), positioned by Nordic for CRA. Over `west spdx` it adds per-file **license detection**, **PURL/CPE** ids, package supplier, an **HTML report**, and handles **sysbuild natively per-domain** — so the fragile `--init`/touch-CMakeLists reply dance (Fallback A) is **not needed**. Output is **SPDX 2.2** (west spdx is 2.3 — both CRA-acceptable; label which you produced).
1. **Deps pre-flight (don't crash):** if `ncs-sbom` errors on a missing import, install its deps: `pip3 install -r <ncs>/nrf/scripts/requirements-west-ncs-sbom.txt`. Detect-and-instruct; never dead-end.
2. **Build** to a Ninja build dir: `west build -d build -b <board> .`.
3. **Generate:** `west ncs-sbom -d build --output-spdx compliance/sbom/<app>.spdx --output-html compliance/sbom/sbom_report.html`.
   - **Sysbuild:** point `-d` at the **build root** — `ncs-sbom` detects `domains.yaml` and fans out **per-domain** (filenames get `_<domain>`, or use `{domain}` in the path). **No `--init` dance.**
   - **Skip scancode** (long-running): pass `--license-detectors spdx-tag,full-text,external-file` (omit `scancode-toolkit`). There is **no `-n` flag** — don't invent one.
4. **License data = evidence-to-verify, not authoritative** — Nordic marks license detection **experimental**. Surface licenses as "detected — verify", never as a compliance fact (readiness-not-compliance).
5. `west ncs-sbom` **only generates** — no CVE/vulnerability scanning, so nothing to fence (advisories stay surface-and-link via the advisories bit).

## Fallback A — west spdx (upstream-generic; the hardened recipe)
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

## Spaces in the project path break the build — stage to a space-free dir
Zephyr/CMake devicetree preprocessing splits the `app.overlay` path on spaces, so a project under a path
like `…/Adsum IoT Coder/…` or `~/Desktop/My Project/` fails configure with *"fatal error: /…/Adsum: No
such file or directory"* — **even with the app dir quoted, and even via a symlink** (CMake resolves the
real path). Don't burn rebuilds fighting the quoting: **copy the project into a space-free temp dir**
(e.g. `cp -r <proj> /tmp/cra-src/<app>`) and build from there. The read-only bundled sample is already
copied for building — copy it into a **space-free** temp (the install path may contain spaces).

## Sysbuild recipe (the nRF default — this works, don't give up)
On **sysbuild** projects `west spdx -d build` fails with *"cmake api reply directory
…/.cmake/api/v1/reply does not exist"* — because the file-based API lives in the **image sub-build**, not the
sysbuild root, and `--init` only drops a *query* dir: CMake must run **again** to emit the *reply* the walker
reads. Verified working sequence (produces real SPDX, not SBOM-lite):
1. Build once so the tree exists: `west build -d build -b <board> .`
2. `west spdx --init -d build/<image>` — the **image** dir (e.g. `build/central_uart`), NOT `build/`.
3. Force CMake to re-run so the reply is written — touch a CMake input (`touch CMakeLists.txt`), then
   `west build -d build -b <board> .` **(non-pristine)**. *(`ninja: no work to do` means CMake did NOT re-run
   and the reply still won't exist — touch an input and rebuild until you see CMake reconfigure.)*
4. `west spdx -d build/<image>` → emits `build/<image>/spdx/{app,zephyr,build,modules-deps}.spdx`.
5. **Copy the `*.spdx` into `compliance/sbom/`** — don't leave them under `build/`.
> **Never run `west build -p` (pristine) after `--init`.** Pristine wipes `build/<image>/.cmake/api`, taking the
> query dir with it, and you're back to the reply-missing error. Do all pristine builds **first**, `--init` **last**.

## Fallback B — SBOM-lite (true last resort)
Use this **only** if both `west ncs-sbom` and `west spdx` genuinely can't run (e.g. absent on this SDK version) **after** the recipes
above — never on the first error. Fall back to `west list` → a markdown component inventory written to
`compliance/sbom/`, with the **exact** heading **"SBOM-lite (component inventory, not SPDX)"** so no one
mistakes it for the CRA's named SPDX artifact.
- **Reconcile the version before you write it.** `west list` reports the **west workspace/manifest**
  revisions, which can differ from what the build actually consumed. Cross-check against the build's
  `<build>/<image>/zephyr_modules.txt` module paths (e.g. `/opt/nordic/ncs/v3.3.1/…`). **If they disagree on
  the NCS version, say so** ("west workspace = v3.2.1, build linked v3.3.1 modules — verify") rather than
  stamping one version across the whole inventory.

## Safety
`shell` (runs `west`), `long-running` (the build). No flash/erase. No network.

> ⚠️ **VERIFY ON HARDWARE before launch (NCS 3.2.1):** on a real build confirm the `west ncs-sbom`
> `-d` / `--output-spdx` / `--output-html` flags, the `nrf/scripts/requirements-west-ncs-sbom.txt` deps
> path, and the `--license-detectors` behaviour (is scancode pulled in by default?). Keep the Fallback A
> `west spdx --init/-d` flags verified too. Flags drift across versions — version-gate if needed.
