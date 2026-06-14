---
id: adsum/esp/actions/configure
title: "Action: Change Project Config"
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
---

# Action: Change Project Config (actions/configure.md)

## When Used
Whenever a build/runtime fix or the user requires a **Kconfig value** change: Wi-Fi credentials, MQTT broker URL, GPIO pin numbers, I2C/SPI addresses, partition/flash size, task stack sizes, log levels, PSRAM mode, etc.

## The one rule that bites everyone
There are TWO config files and they are NOT interchangeable:

| File | Role | When it takes effect |
|---|---|---|
| `sdkconfig` | the **active**, generated config that the build actually reads | **immediately** on the next build |
| `sdkconfig.defaults` | checked-in **seed** values | **only when `sdkconfig` is (re)generated** — i.e. first build, or after `fullclean` / `set-target` (which delete `sdkconfig`) |

**Editing `sdkconfig.defaults` alone does NOTHING if `sdkconfig` already exists** — the active `sdkconfig` wins. This is the classic "I changed the Wi-Fi password but it still uses the old one" bug.

## The clean way to change a value
1. **Find the exact Kconfig symbol.** Don't guess. `search_files` in `sdkconfig` and in `**/Kconfig.projbuild` / `**/Kconfig` for the feature (e.g. `WIFI_SSID`, `WIFI_PASSWORD`, `BROKER_URL`, `EXAMPLE_`). IDF examples commonly use `CONFIG_EXAMPLE_WIFI_SSID` / `CONFIG_EXAMPLE_WIFI_PASSWORD`.
2. **Set it in BOTH files:**
   - `sdkconfig` — so it takes effect on the next build.
   - `sdkconfig.defaults` — so it survives a `fullclean` / `set-target`.
   Use the exact `CONFIG_NAME="value"` (quotes for strings, `y`/`n` for bools, bare number for ints).
3. **Rebuild** (`actions/build.md`). `idf.py build` reconfigures because `sdkconfig` changed.
4. **Verify it landed:** `read_file` `sdkconfig` and confirm the new value, or confirm in the boot log (e.g. `example_connect: Connecting to <SSID>`).

> If a value lives in source as a `#define` (not Kconfig), edit the source instead — `search_files` for the macro name. Pins/addresses are sometimes `#define`, sometimes Kconfig; check both.

## Secrets (Wi-Fi password, tokens, broker creds)
- `sdkconfig.defaults` is usually **committed to git**; `sdkconfig` is usually **gitignored**. So putting a real password in `sdkconfig.defaults` may commit it.
- For the user's local debugging, set it in `sdkconfig` (takes effect, not committed) and tell the user. Only mirror secrets into `sdkconfig.defaults` if they confirm it's acceptable, or use a gitignored `sdkconfig.local` / a separate secrets header.
- **Never invent credentials.** Ask the user for SSID/password/URLs; do not place dummy values and flash.

## After configuring
Return to the workflow that called you (usually `debug-loop.md` Phase 1 → rebuild → reflash → recapture to confirm the fix).
