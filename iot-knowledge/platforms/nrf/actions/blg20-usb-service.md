---
id: adsum/nrf/actions/blg20-usb-service
title: "Action: BLG20 USB Service"
type: action
version: 0.1.0
owner: adsum-core
author: Omar Morceli
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
safety: [flash]
requires:
  - adsum/nrf/tools/blg20-service
---

# Action: BLG20 USB Service (actions/blg20-usb-service.md)

## When Used
Called from: `workflows/blg20-usb-journey.md`. Also fires directly when: a BLG20 gateway is plugged
into USB; a serial port enumerates as "BLG20 Gateway"; the user asks what the gateway is, what its
status is, to update it, or to read its logs.

## How

Every command is `blg20-service <cmd> [args] --json`. Read stdout as one JSON object; progress
lines go to stderr. Run one command at a time per unit — a second run against the same unit while
one is mid-session will find the port busy or the session already unlocked-and-ending.

**Order:** `list` → `passport` → `needs`. Only after that, act on what `needs` says.

1. **Discover.** `blg20-service list --json` — the units on USB and their two ports (service +
   LTE tunnel, if present). If more than one unit is present, ask which one, then pass
   `--port <service_port>` to every later command.
2. **Passport (no key needed).** `blg20-service passport --json` — identity, firmware versions,
   build type (demo/production), `claimed`, `locked`. This is always safe to run first, even on a
   unit the user does not own.
3. **Needs (no key needed).** `blg20-service needs --json` — the closed list of codes below.
4. **Claim — only when the user explicitly asks to own the unit.** `blg20-service claim --json`.
   Never run this because a later command failed for lack of a key; ask the user first. A unit
   already claimed by someone else's key returns `ok: false` — report that, do not retry with a
   different key unless the user names one.
5. **Everything else unlocks automatically inside its own run** (`health`, `logs`, `images`,
   `update-ble`, `update-lte`, `lock`, `owner-set`, `owner-clear`) with this PC's owner key. On an
   UNCLAIMED unit they stop with "run claim first": relay that and ask whether the user wants to
   own the unit (step 4).
6. **Logs.** `blg20-service logs --chip ble --json` or `--chip lte --json`, with `--lines N` if the
   user wants more/fewer than the default 64.
7. **Update.** `blg20-service update-ble <path-to-zephyr.signed.bin> --json` for the BLE half,
   `update-lte <path> --json` for the LTE half. Tell the user before you start: the BLE update
   takes about half a minute and drops the USB port while the unit reboots; the LTE update takes
   about two and a half minutes over the link between the chips. Both are expected. The result's
   `state` is `confirmed` when the new image passed its health check; anything else means the unit
   kept or will return to its previous image (a bad image reverts on the next boot).
8. **The tool refuses an image that would cut the unit off** (a BLE image without the USB service
   port, an LTE image without the link SMP server, or a file that is not a signed MCUboot image).
   Relay the message; never add `--force` unless the user explicitly asks after reading it.

## `needs` → what to tell or do

| Code | What it means | What to do |
|---|---|---|
| `not-commissioned` | The unit was never commissioned for a site | Commissioning is done over Bluetooth with the commissioner page (Chrome, Web Bluetooth), not over USB |
| `no-position` | No commissioned position (NB-NTN needs it; there is no GNSS) | Set it in the commissioner page's "State the position" step |
| `no-network-credential` | No network credential written at commissioning | Set it in the commissioner page's "Name it and give it a credential" step |
| `link-down` | BLE↔LTE internal link is down | Re-run `needs` after a minute; if it persists, note it and move on — do not power-cycle over this tool |
| `lte-silent` | LTE chip not answering | Check `logs --chip lte`; if truly silent, say so — do not attempt `update-lte` to "wake" it |
| `lte-image-on-test` | An LTE image is on-test, awaiting confirmation | Report it; do not start a new `update-lte` on top of one already on test |
| `no-clock` | Unit has no time source yet | Tell the user; resolves once the network attaches |
| `data-parked` | The data allowance was reached; uplinks are parked until it renews | Report it; the unit keeps storing records meanwhile |
| `attach-ban` | Network has temporarily banned the attach | Tell the user; do not retry attach commands — this tool has none |
| `radio-inhibited` | Radio is deliberately held off | Tell the user; check whether that was intentional |
| `uplink-never` | No uplink has ever succeeded | Report it; check `logs --chip lte` for the cause |
| `uplink-unanswered` | An uplink was sent, no reply | Report it; usually a network-side or coverage issue |
| `ble-image-on-test` | A BLE image is on-test | Report it; do not start `update-ble` on top of one already on test |
| `store-absent` | The external record store did not come up | Tell the user; records are forwarded live only |
| `store-high` | The record store is nearly full (the uplink is behind) | Tell the user; check `logs --chip lte` for why the uplink is slow |
| `no-owner-key` | Commissioned but unclaimed: anyone with a cable could claim it | Suggest `claim`; run it only when the user asks |
| `no-service-key` | The image carries no vendor key and no owner is set: nobody can unlock it | Tell the user; a unit in this state needs a claim or a rebuilt image |
| *anything else* | Unknown code | Say plainly: "attention needed — code `<x>`, meaning not in the known list" — do not guess |

## Rules

- **Never read, print, move, or paste a private key file** (any `.pem` under the keyring folder).
  `key-path` shows where the key lives — that is the only key-related output to surface.
- **Never claim a unit the user did not explicitly ask to own.** `claim` is a one-way handoff of
  ownership; do not run it speculatively to "see what happens" or to unblock a locked read.
- **Never pass `--key` with a key the user did not name.** If a command needs the owner key and
  none exists, say so and ask — do not substitute the vendor service key or a guess.
- **USB is the path for a BLG20 the user can already reach over USB.** Do not fall back to SWD
  flashing for a unit that has a working USB service port unless the user asks for SWD specifically
  — `update-ble` / `update-lte` are how this device is meant to be updated.
- **One tool run at a time per unit.** Do not start a second `blg20-service` command against the
  same unit while an update or a capture is in progress.
- **Name ports the way the platform does.** Windows: `COM<n>`. Linux: `/dev/serial/by-id/...` (or
  the `/dev/ttyACM<n>` the unit reports) — never invent a port name.
- **If `doctor` reports a missing Python module** (`serial` or `cryptography`), offer the
  one-click install into the user's own Python rather than telling them to run a command
  themselves — this follows the same zero-manual-setup rule as the rest of the extension.
- **A BLE update dropping the USB port is expected, not a fault.** Do not report it as an error or
  retry the command while the unit is mid-reboot; wait for the tool's own confirmation result.
