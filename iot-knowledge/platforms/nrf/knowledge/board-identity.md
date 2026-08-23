---
id: adsum/nrf/knowledge/board-identity
title: "Reference: Nordic Board Identity"
type: knowledge
version: 1.0.0
owner: adsum-core
author: Omar Morceli
co_authors:
  - handle: ismail-hamdad
    name: Ismail Hamdad
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
min_ext: "0.3.0"
---

# Reference: Nordic Board Identity (platforms/nrf/knowledge/board-identity.md)

PCA number → the board a developer would recognise. `nrfutil device list` reports the PCA; nobody
calls it that out loud.

This lives in a bit rather than in the extension because Nordic ships boards between our releases.
Correcting a name here reaches a developer through the registry; correcting it in the code needs a
new VSIX — and one already went out for exactly that (`fd54807b`, "name the newer Nordic DKs, and
correct PCA10100").

**Every entry is read from the board definitions in an installed SDK**
(`<ncs>/zephyr/boards/nordic/*` and `<ncs>/nrf/boards/nordic/*`), never from memory. That is how
PCA10100 was caught: it had been mapped to "nRF5340 DK" and is actually the nRF52833 DK. To extend
the table, do the same — `grep -rhoiE "PCA[0-9]{5}" <ncs>/zephyr/boards/nordic/<board>/` — and add
the row only once a board definition confirms it.

```yaml
boards:
  - pca: PCA10028
    name: nRF51 DK
  - pca: PCA10031
    name: nRF51 Dongle
  - pca: PCA10040
    name: nRF52832 DK
  - pca: PCA10056
    name: nRF52840 DK
  - pca: PCA10059
    name: nRF52840 Dongle
  - pca: PCA10090
    name: nRF9160 DK
  - pca: PCA10095
    name: nRF5340 DK
  - pca: PCA10100
    name: nRF52833 DK
  - pca: PCA10112
    name: nRF21540 DK
  - pca: PCA10121
    name: nRF5340 Audio DK
  - pca: PCA10143
    name: nRF7002 DK
  - pca: PCA10153
    name: nRF9161 DK
  - pca: PCA10156
    name: nRF54L15 DK
  - pca: PCA10165
    name: nRF9131 EK
  - pca: PCA10171
    name: nRF9151 DK
  - pca: PCA10184
    name: nRF54LM20 DK
  - pca: PCA20020
    name: "Thingy:52"
  - pca: PCA20035
    name: "Thingy:91"
```

## A board with no PCA is not an unknown board

A third-party module — a XIAO, a Fanstel module — carries an on-board CMSIS-DAP rather than a SEGGER
J-Link, so `nrfutil device list` reports no `devkit` object and no PCA at all. Its identity is the USB
product string, which names the chip. Do not report such a board as unrecognised: name it by its
product string, and remember it is a *different board target* from the DK carrying the same silicon.
