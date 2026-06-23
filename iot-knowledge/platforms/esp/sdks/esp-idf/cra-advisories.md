---
id: adsum/esp/sdks/esp-idf/cra-advisories
title: CRA Advisory Snapshot (ESP-IDF)
type: knowledge
version: 0.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: cra
platform: esp
sdk: esp-idf
created: "2026-06-23"
status: draft
---

# CRA Advisory Snapshot — ESP-IDF (platforms/esp/sdks/esp-idf/cra-advisories.md)

A **dated, curated** snapshot of known Espressif / ESP-IDF security advisories, keyed by ESP-IDF version — the
cross-vendor parallel to the NCS advisories bit. Used by the CRA SBOM & Fix workflow as a **bonus**: surface
the relevant advisories for the detected ESP-IDF version with links. **Surface-and-link ONLY — never an
affected / not-affected verdict** (that matching is the paid, higher-liability layer). Often sparse — a bonus,
not a pillar.

> 🚫 **NO-AUTO-POPULATE FENCE (mission-exit line).** The entries below are **authored by us at build time
> only.** **NEVER** populate, infer, or extend this list **at runtime** from any scanner or network source —
> not `esp-idf-sbom check`, not `idf.py`, not the NVD/CVE API, not a web fetch, not SBOM→CVE matching. If the
> table is empty for the detected version, surface the **live-source links** below and say "no bundled
> advisories for ESP-IDF <x> as of <date>; check live" — **never synthesize an entry**, and never imply the
> project is therefore clear. A vulnerability-matching engine is the out-of-scope, higher-liability layer we
> deliberately do not build.

## Snapshot date
**As of: 2026-06-23.** Always tell the user: *"as of <this date>; check the live advisory sources for anything
newer."* This snapshot is refreshed per release.

## How the workflow uses this
- Match the detected **ESP-IDF version** (`dependencies.lock` top-level `idf:`, or `idf.py --version`) to the
  entries below; surface matches with their links.
- If there are **no entries** for the version, say so plainly ("no bundled advisories for ESP-IDF <x> as of
  <date>; check live") — do not imply the project is therefore clear.

## Live sources (always link these)
- Espressif security advisories / PSIRT (`espressif.com` security advisories).
- The ESP-IDF GitHub Security Advisories (`github.com/espressif/esp-idf` → Security).
- NVD / CVE for specific components surfaced in the SBOM.

## Advisories by ESP-IDF version
> ⚠️ **TO POPULATE before launch** — curate the real, dated entries per ESP-IDF version (e.g. 5.2.x / 5.3.x).
> Keep each to: id/link · affected versions · one-line summary · remediated-in version. **No verdicts.** Until
> populated, the workflow surfaces the live-sources links above with the "as of" caveat.

| ESP-IDF version | Advisory (link) | Summary | Remediated in |
|---|---|---|---|
| _to populate_ | — | — | — |

> ⚠️ **VERIFY before launch:** curate from the live Espressif PSIRT + ESP-IDF GitHub advisories for the
> cohort's ESP-IDF version; keep surface-and-link only.
