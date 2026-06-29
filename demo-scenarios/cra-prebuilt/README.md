# CRA pre-built reference bundles

Pre-built, **read-only** CRA artifacts so the **CRA Sample run** can do a full, live CVE scan + posture + report
**without a local build** (the user almost never has the exact SDK our sample was built on). Each bundle is laid out
like a build dir so the existing `triggerCveScan build=<bundle>` drives it; the host reads `zephyr/symbols.nm` instead
of running `nm` on a (deliberately not-shipped) ELF.

The Sample run is a **simulated reference run** — clearly labelled "reference sample — NOT your build" — and always
offers the user the real, live run on their own project. See `design/34-cra-sample-precanned.md`.

- `nrf/` — central_uart, NCS 3.2.1 / Zephyr 4.2.99, nrf52840dk (captured 2026-06-29). See `nrf/meta.json`.
- `esp/` — follow-up.

**Refresh** when the pinned SDK drifts: rebuild the sample, copy `all.spdx` + merged `.config` + `version.h`, and
`nm <zephyr.elf> > zephyr/symbols.nm`; bump `capturedDate` in `meta.json`.
