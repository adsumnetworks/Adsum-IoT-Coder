---
id: adsum/nrf/sdks/ncs/cra-advisories
title: CRA Advisory Snapshot (NCS)
type: knowledge
version: 0.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: bundled
domain: cra
platform: nrf
sdk: ncs
created: "2026-06-18"
status: draft
---

# CRA Advisory Snapshot — NCS (platforms/nrf/sdks/ncs/cra-advisories.md)

A **dated, bundled** snapshot of known Nordic / Zephyr security advisories, keyed by NCS version. Used by
the CRA Readiness Check as a **bonus**: surface the relevant advisories for the detected SDK version with
links. **Surface-and-link ONLY — never an affected / not-affected verdict** (that matching is the paid,
higher-liability layer). Often sparse — a bonus, not a pillar.

## Snapshot date
**As of: 2026-06-18.** Always tell the user: *"as of <this date>; check the live advisory sources for
anything newer."* This snapshot is refreshed per release.

## How the workflow uses this
- Match the detected **NCS version** to the entries below; surface matches with their links.
- If there are **no entries** for the version, say so plainly ("no bundled advisories for NCS <x> as of
  <date>; check live") — do not imply the project is therefore clear.

## Live sources (always link these)
- Nordic DevZone security advisories / PSIRT.
- Zephyr Project security advisories (GitHub Security Advisories on `zephyrproject-rtos/zephyr`).
- NVD / CVE for specific components surfaced in the SBOM.

## Advisories by NCS version
> ⚠️ **TO POPULATE before launch** — curate the real, dated entries per NCS version (e.g. 3.2.x). Keep each
> to: id/link · affected versions · one-line summary · fixed-in. **No verdicts.** Until populated, the
> workflow surfaces the live-sources links above with the "as of" caveat.

| NCS version | Advisory (link) | Summary | Fixed in |
|---|---|---|---|
| _to populate_ | — | — | — |
