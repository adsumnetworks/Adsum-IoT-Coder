---
id: adsum/esp/rules/cra-posture
title: CRA Secure-by-Design Posture (ESP)
type: knowledge
version: 0.2.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: cra
platform: esp
sdk: esp-idf
created: "2026-06-18"
updated: "2026-06-22"
status: draft
---

# CRA Secure-by-Design Posture — ESP (platforms/esp/rules/cra-posture.md)

The secure-by-design **posture preview** for ESP-IDF — the cross-vendor parallel to the nRF posture. Each
check reads **real build evidence** and reports it in **evidence-mode**: the **curated requirement** (our
words, sourced to the public CRA regulation) · what **your build literally shows** · what **you verify**. A
labelled *preview*, dated **"11 Dec 2027 essential cybersecurity requirements (CRA Annex I, Part I) — worth
doing now"** — never a pass/fail, never a merge blocker, never the hero.

## Overview — how to read each check
- **Read the resolved config, not a guess.** Evaluate against `build/config/sdkconfig.json` (the merged,
  authoritative config) — or the project `sdkconfig` if no build exists. `sdkconfig.defaults` alone misses
  what menuconfig/board defaults merged in. If absent, say so and offer a build (don't guess).
- **Evidence-mode, never a verdict.** Report the literal symbol state, **neutrally**, bound to that row's
  named symbol: present → "`CONFIG_X=y` is present"; absent → "`CONFIG_X`: not present in this `sdkconfig`
  — verify whether your design intends it." **Never** "✅ / ⚠️ / ❌", never "Strong / Weak / Pass", never
  "missing/violation". A requirement is **never** phrased as an unmet imperative sitting beside an absent
  symbol. The conclusion — does your build meet it — is the developer's (or their notified body's).
- **Verify the positive AND the negative.** "Present" requires the check's **named symbol present**;
  "not present" requires it genuinely absent. Don't narrate a feature present when its symbol is absent
  (regardless of adjacent symbols), nor absent when it's there. **This re-read is the load-bearing honesty
  guard — a curated citation never makes a misread safe.**
- **Target applicability is real evidence too.** ESP security symbols vary by chip: **Secure Boot scheme**
  is RSA on ESP32 (rev v3.0+), ESP32-S2/S3, ESP32-C3 (ECO3); **ECDSA** on ESP32-C2; original ESP32
  (pre-rev3) supports only **Secure Boot v1 (AES)**. **Memory protection** uses **PMS** on Xtensa cores
  (ESP32/S2/S3) and **PMP** on RISC-V cores (C3/C6/H2/P4) — same `CONFIG_ESP_SYSTEM_MEMPROT` parent,
  different mode. State "depends on your target" rather than inventing a fixed N/A; read `CONFIG_IDF_TARGET`.

> **Curated-static citations — the rule.** The "Requirement" column is authored by us in plain English,
> sourced to the public CRA regulation. You may surface the **Part I / Part II** label **exactly as written
> below** — fixed, copied labels, never selected or invented. **Nothing finer** (no "Annex I 2.(d)", no
> article numbers) — guessed clause letters are frequently wrong; the fine-grained Annex/clause + EN 18031
> mapping is pending expert validation. Cite a vendor doc only as a generic "see also" feature link.

## The checks (requirement → your build shows → you verify)

| # | Check | Requirement (our words, sourced to CRA Annex I) | Your build shows — read the named symbol literally | You verify |
|---|---|---|---|---|
| 1 | **Secure boot** | Boot only verified firmware — integrity + the root of trust. *(Part I)* | `CONFIG_SECURE_BOOT` + `CONFIG_SECURE_BOOT_V2_ENABLED` present / not present (signed-app-only: `CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT`) | If you intend hardware secure boot, enable it (v2 where the target supports it) — not just signed-app-without-secure-boot, which doesn't stop a flash-write attacker. |
| 2 | **Flash encryption** | Protect firmware/data confidentiality at rest. *(Part I)* | `CONFIG_SECURE_FLASH_ENC_ENABLED` + `CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE` present / not present | For production verify **Release** mode (Development mode is explicitly "NOT SECURE" — leaves ROM-download flash-encryption open). |
| 3 | **Signed / secure OTA update** | A secure mechanism to ship integrity-protected updates over the support period. *(Part I)* | `CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT` or full secure boot present / not present | If you need field updates, verify images are signed (chained to the bootloader where hardware secure boot is on). |
| 4 | **Anti-rollback** | Prevent downgrade to a known-vulnerable firmware version. *(Part I)* | `CONFIG_BOOTLOADER_APP_ANTI_ROLLBACK` (+ `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`, `CONFIG_BOOTLOADER_APP_SECURE_VERSION`) present / not present | If you patch in the field, verify anti-rollback + an ota_0/ota_1 partition scheme so a downgrade can't reintroduce a patched vuln. |
| 5 | **Debug interfaces locked (production)** | Minimise the attack surface — close JTAG + the ROM/UART download path in production. *(Part I)* | `CONFIG_SECURE_DISABLE_ROM_DL_MODE` present / not present (note: enabling Secure Boot / Flash-Enc **Release** also disables JTAG + the ROM-download flash path via eFuse) | If this is production, verify the debug/download paths are closed. Caution: eFuse changes are **irreversible** — never on a dev board. |
| 6 | **Secure key storage / crypto** | Protect confidentiality; store keys/secrets securely. *(Part I)* | `CONFIG_NVS_ENCRYPTION` (+ `CONFIG_NVS_SEC_KEY_PROTECTION_SCHEME`) and the mbedTLS / DS-peripheral / HMAC path present / not present | Verify secrets use encrypted NVS + the hardware crypto (DS/HMAC), not plaintext in flash. NVS encryption requires flash encryption. |
| 7 | **Memory protection** | Mitigate memory-corruption exploits. *(Part I)* | `CONFIG_ESP_SYSTEM_MEMPROT` (+ mode `_PMS` on Xtensa / `_PMP` on RISC-V; lock `_PMS_LOCK` is PMS-only) present / not present | Verify memory protection suits your target (PMS vs PMP by core). |
| 8 | **Logging hygiene** | Don't leak secrets; minimise sensitive data in logs. *(Part I)* | `CONFIG_LOG_DEFAULT_LEVEL` + heuristic grep of `main/`/`components/` for secrets in `ESP_LOG*`/`printf` | Heuristic — review any flagged lines yourself; confirm no secrets are logged. |
| 9 | **Console in production** | Don't ship an interactive debug surface in production. *(Part I)* | `CONFIG_ESP_CONSOLE_UART_DEFAULT` vs `CONFIG_ESP_CONSOLE_NONE` present / not present | If this is a production build, verify the serial console is disabled (`ESP_CONSOLE_NONE`). |
| 10 | **SBOM generated** | Identify & document components (the named machine-readable SBOM). *(Part II — vulnerability handling)* | this run produced `compliance/sbom/` (yes / no) | Generated by the SBOM step (`esp-idf-sbom create`); keep it updated when components change. |

> **Flash encryption / secure boot are one-way (eFuse).** These burn eFuses and are **permanent** on first
> boot. Read the config as *intent*; never tell the developer to enable them on a board they can't sacrifice,
> and never imply a build flag alone proves the eFuses were actually burned — that needs `espefuse.py summary`
> on the device (out of scope here; surface as "verify on the device").

## "Worth doing now" — dependency order (not just severity)
1. **Secure Boot v2** — the root of trust; signed OTA + anti-rollback build on it.
2. **Flash Encryption (Release)** — confidentiality at rest; NVS encryption depends on it.
3. **Signed/secure OTA** + **anti-rollback** — safe field updates that can't be downgraded.
4. **Lock debug/download paths**, then memory protection, secure key storage, logging hygiene, console-off.

> Verification status: the Kconfig→requirement mappings are curated from the ESP-IDF security docs and are
> best-effort, pending an expert pass + **hardware verification on the cohort's ESP-IDF** (symbols move
> across IDF versions; eFuse state must be confirmed on-device). Treat as a *preview*, not an audit. The
> Part I/Part II labels are coarse (the regulation's two halves); finer clause mapping ships after expert review.
