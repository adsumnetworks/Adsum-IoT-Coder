---
id: adsum/nrf/tools/blg20-service
title: "blg20-service"
type: tool
version: 0.1.2
owner: adsum-core
author: Omar Morceli
license: Apache-2.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
min_ext: "0.3.0"
runtime: python3
entry: blg20_service.py
usage: 'list | passport [--chip lte] | needs | claim | logs [--chip ble|lte] [--lines N] | update-ble FILE | update-lte FILE [--force] | doctor   # add --json for one JSON object on stdout'
safety: [flash, long-running]
readonly: false
artifacts:
  - path: blg20_service.py
    sha256: ae47dfdcd6ffb51f92081d7b44ff719817941c645ab00d98c40c0e4e5ac64be2
  - path: blg20-service
    sha256: 0a970d6858786119ca2912ab42d5a4b19766b67671ddcd296fe07b0a9655cfe3
  - path: blg20-service.bat
    sha256: 8ca8de7dba094ecd4624c64b7753136e27c0873506ca03d563422b5ea24a81f9
---

Talk to a BLG20 gateway's USB-C service port from the PC: MCUmgr SMP over USB CDC ACM (VID 0x1209
PID 0x0001, product "BLG20 Gateway"). Two chips share the unit — BM20 (nRF54LM20B, BLE, owns USB)
and nRF9151 (LTE/NB-IoT/NTN) — and the unit shows two serial ports: interface 0 is the BLE service
port, interface 2 is the LTE tunnel (open only while the service port is unlocked).

**The port is locked by default.** `passport` and `doctor` work on a locked unit (identity,
versions, build type, claimed/locked state — no key needed). Everything else needs the owner key.
`claim` makes this PC's own key (kept in the keyring folder — see `key-path`) the unit's owner on
an unclaimed unit; after that only that key unlocks it. `--key PEM` swaps in a different key (the
vendor service key, a colleague's) for one run.

**A session is one run of the tool.** The unit ends the unlocked session when the service port
closes, so each invocation unlocks once and does everything it needs inside that run — do not
script a wait between two separate `blg20-service` calls expecting the unit to stay unlocked.

**Never read, print, paste or move the owner private key file.** It lives only in the keyring
folder this tool manages; it is not something to put in chat, a log, or a commit.

`update-ble FILE` / `update-lte FILE` take a signed image (`zephyr.signed.bin`), upload it,
test-boot it and wait for the unit to confirm it — a bad image reverts on the next boot. The BLE
update drops the USB port for up to 1-2 minutes while the unit reboots; the LTE update runs over
the internal 115200-baud link and takes several minutes. Both are expected delays, not failures.

Add `--json` to any command for one JSON object on stdout; progress goes to stderr. Needs Python 3
with pyserial and cryptography (CBOR is built in) — `doctor` reports which are missing.
