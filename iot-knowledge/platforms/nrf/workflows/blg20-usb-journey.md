---
id: adsum/nrf/workflows/blg20-usb-journey
title: "BLG20 USB Journey Workflow"
type: workflow
version: 0.1.0
owner: adsum-core
author: Omar Morceli
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
triggers: ["BLG20 gateway", "BLG20 USB service", "blg20-service"]
requires:
  - adsum/nrf/actions/blg20-usb-service
  - adsum/nrf/tools/blg20-service
---

# BLG20 USB Journey Workflow (workflows/blg20-usb-journey.md)

**Triggered by:** a BLG20 gateway plugged into USB (a serial port named "BLG20 Gateway"), or the
user asking what it is, its status, to update it, or to read its logs.

> **MANDATORY BIT LOAD:** before running any `blg20-service` command, `read_file`
> `platforms/nrf/actions/blg20-usb-service.md` now, if it is not already in your context this task
> (Load-Once — skip if already loaded). That Action has the exact command order, the `needs` table,
> and the key-safety rules. Do not improvise the sequence from this workflow's step names alone.

---

## Step 1 — Detect

Run `blg20-service list --json`. If nothing is found, say so plainly — do not guess a port. If more
than one unit is present, ask which one and carry `--port <service_port>` through every later step.

## Step 2 — Passport

Run `blg20-service passport --json`. This needs no key and works on a unit the user does not own.
Report identity, firmware versions, build type (demo/production), and whether the unit is
`claimed`/`locked`. This is the answer to "what is this gateway" and "what's its status".

## Step 3 — Needs

Run `blg20-service needs --json`. Walk the codes against the table in
`actions/blg20-usb-service.md` — most are informational; only `no-owner-key` has an action attached
(and only on request — see Step 4).

## Step 4 — Claim (only on explicit request)

If, and only if, the user asks to own this unit, run `blg20-service claim --json`. Do not run this
because Step 3 showed `no-owner-key` on its own — that code is informational until the user decides
to act on it. A unit already claimed by another key reports `ok: false`; relay that and stop.

## Step 5 — Logs, when there is trouble

If `needs` showed a code that points at the radio or the link, or the user reports a symptom, pull
logs before guessing: `blg20-service logs --chip ble --json` and, if the symptom is cellular,
`blg20-service logs --chip lte --json`. Read the lines before forming a theory — do not diagnose
from the `needs` code alone when logs are one command away.

## Step 6 — Update

Update the BLE half first, then the LTE half; verify each before moving to the next:

1. `blg20-service update-ble <path-to-zephyr.signed.bin> --json` — about half a minute; the USB
   port drops while the unit reboots, which is expected.
2. `blg20-service passport --json` — confirm the new `ble_fw`/`build` and `ble_confirmed`.
3. `blg20-service update-lte <path-to-zephyr.signed.bin> --json` — about two and a half minutes
   over the link between the chips.
4. `blg20-service passport --chip lte --json` — confirm the new `lte_fw`/`build` and `confirmed`.

On the Adsum bench, ready-made signed images are in `~/adsum-projects/blg20-usb/dist/usb/`:
`ble-demo`, `ble-prod`, `lte-demo`, `lte-prod` (`.signed.bin`). "Update to production" means
`ble-prod` then `lte-prod`; "back to the demo" means `ble-demo` then `lte-demo`.

If either update reports `ok: false` or a state other than `confirmed`, stop and report the state —
do not retry blind; check `logs` for the chip that failed.

## Step 7 — Custom firmware loop

For a developer iterating on their own BLG20 firmware, not a stock release image:

1. Build with `west build --sysbuild`, per `actions/build.md`, with the fragments that keep the
   half reachable over USB and the key the unit's bootloader holds (quoted: it is a string option).
   The tree on the Adsum bench is `~/adsum-projects/blg20-usb`; keys are in
   `~/.config/adsum/blg20-signing/` (pass the path, never read the file).
   - BLE half: `west build -b blg20/nrf54lm20b/cpuapp -d build-ble-custom src/bm20-ble --sysbuild --
     -DBOARD_ROOT=$PWD -DSB_CONFIG_BOOT_SIGNATURE_KEY_FILE="\"<keys>/bm20-ed25519.pem\""
     -DEXTRA_CONF_FILE="service.conf" -DEXTRA_DTC_OVERLAY_FILE=service.overlay` (add `demo.conf;`
     for a demo build). Image: `build-ble-custom/bm20-ble/zephyr/zephyr.signed.bin`.
   - LTE half: `west build -b blg20/nrf9151/ns -d build-lte-custom src/nrf9151-app --sysbuild --
     -DBOARD_ROOT=$PWD -DSB_CONFIG_BOOT_SIGNATURE_KEY_FILE="\"<keys>/nrf9151-p256.pem\""
     -DEXTRA_CONF_FILE="radio.conf;smp.conf"` (without `radio.conf` the radio stays off; on the
     bench, append the absolute path of the tenant's `secrets.conf` and never publish that image).
     Image: `build-lte-custom/nrf9151-app/zephyr/zephyr.signed.bin`.
   An image signed with another key is refused by the bootloader: the update ends not confirmed
   and the unit keeps its image. The tool refuses outright an image without the USB fragments.
2. Run Step 6 (`update-ble` or `update-lte`) against the build's own `zephyr.signed.bin`.
3. Run Step 2 (`passport`) and Step 5 (`logs`) to confirm the new build is running and behaving —
   this closes the loop the same way `debug-loop.md` closes Build → Flash → Capture → Analyze for a
   DK, just over USB instead of SWD.

## Rules

- USB is the path for a unit already reachable over USB — do not fall back to SWD flashing unless
  the user asks for it specifically.
- Never claim a unit the user did not explicitly ask to own.
- Never read, print, or move a private key — the owner key or a signing key. Pass paths, not
  contents.
- One `blg20-service` run at a time per unit.
