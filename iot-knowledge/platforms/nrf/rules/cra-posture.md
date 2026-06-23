---
id: adsum/nrf/rules/cra-posture
title: CRA Secure-by-Design Posture (nRF)
type: knowledge
version: 0.2.1
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: cra
platform: nrf
sdk: ncs
created: "2026-06-18"
updated: "2026-06-23"
status: draft
---

# CRA Secure-by-Design Posture — nRF (platforms/nrf/rules/cra-posture.md)

The secure-by-design **posture preview** for nRF/Zephyr. Each check reads **real build evidence** and reports
it in **evidence-mode**: the **curated requirement** (our words, sourced to the public CRA regulation) · what
**your build literally shows** · what **you verify**. This is a labelled *preview*, dated **"11 Dec 2027
essential cybersecurity requirements (CRA Annex I, Part I) — worth doing now"** — never a pass/fail, never a
merge blocker, never the hero.

## Overview — how to read each check
- **Read the merged config, not `prj.conf`.** Evaluate against `build/<target>/zephyr/.config` (board
  defaults + overlays + `prj.conf`). `prj.conf` alone misses everything inherited. If no build exists, say so
  and offer a build (don't guess).
- **Evidence-mode, never a verdict.** Report the literal symbol state, **neutrally**, bound to that row's
  named symbol: present → "`CONFIG_X=y` is present"; absent → "`CONFIG_X`: not present in this merged
  `.config` — verify whether your design intends it." **Never** "✅ / ⚠️ / ❌", never "Strong / Good / Weak /
  Pass", never "missing/violation". A requirement is **never** phrased as an unmet imperative sitting beside
  an absent symbol (that manufactures a verdict by layout). The conclusion — does your build meet it — is the
  developer's (or their notified body's).
- **Verify the positive AND the negative.** "Present" requires the check's **named symbol present** in the
  merged `.config`; "not present" requires it genuinely absent (or `# CONFIG_x is not set`). Don't narrate a
  feature as present when its symbol shows `not set`, regardless of *adjacent* symbols
  (`CONFIG_SECURE_BOOT`, `CONFIG_NCS_MCUBOOT_IN_BUILD`); don't narrate it absent when it's there.
  **This re-read is the load-bearing honesty guard — the curated citation does NOT make a misread safe.**
  (A real run stamped secure boot present where `CONFIG_BOOTLOADER_MCUBOOT` was not set and no bootloader
  image was built.)
- **Chip applicability is real evidence too.** TrustZone-M / TF-M exists only on ARMv8-M Cortex-M33 parts —
  **nRF5340, nRF91, nRF54L** (the nRF54H uses a different security architecture). The **nRF52 series (incl.
  nRF52840) is Cortex-M4 with no TrustZone** → check #6 is **N/A** there (state "not applicable on this
  part"), never a gap. Never describe a 52-part as "Cortex-M4 with TrustZone".

> **Curated-static citations — the rule.** The "Requirement" column is authored by us in plain English,
> sourced to the public CRA regulation. You may surface the **Part I / Part II** label **exactly as written
> below** — these are fixed, copied labels, never a field you select or fill. **Nothing finer:** no "Annex I
> 2.(d)", no article numbers (e.g. "Art. 14(8)") — guessed clause letters are frequently wrong and reopen a
> known failure; the fine-grained Annex/clause + **EN 18031** mapping is pending expert validation. Cite a
> vendor doc only as a generic "see also" feature link, never as "Nordic's CRA guide says you must".

## The checks (requirement → your build shows → you verify)

| # | Check | Requirement (our words, sourced to CRA Annex I) | Your build shows — read the named symbol literally | You verify |
|---|---|---|---|---|
| 1 | **Secure boot** | Boot only verified firmware — integrity + the root of trust for secure update. *(Part I)* | `CONFIG_BOOTLOADER_MCUBOOT` present / not present | If you intend verified boot, enable MCUboot at the **sysbuild** level (recipe + change-impact caveats in the note ↓) + confirm a bootloader sub-image is built. |
| 2 | **Signed update / FOTA** | A secure mechanism to ship integrity-protected updates over the support period. *(Part I)* | `CONFIG_MCUMGR*` / SMP-BT DFU / nRF Cloud FOTA present / not present | If you need field updates, wire a signed-update transport **after** MCUboot (signed images need the bootloader). |
| 3 | **BLE pairing security** | Authenticated, confidential access — no unauthenticated pairing. *(Part I)* | `CONFIG_BT_SMP` + LE Secure Connections (`*_SC_*`) + bonding present / not present; Just-Works / fixed passkey | Confirm LE Secure Connections + bonding; verify no Just-Works / fixed passkey in production. |
| 4 | **Debug-port lock (production)** | Minimise the attack surface — close the debug access port in production. *(Part I)* | `CONFIG_NRF_APPROTECT_LOCK` present / not present (sysbuild: `SB_CONFIG_APPROTECT_LOCK`) | If you need it closed in production, lock APPROTECT. **Multi-image: it must be set in the *first* image (the secure bootloader), or via sysbuild's `SB_CONFIG_APPROTECT_LOCK` for all images** — otherwise it's reopened for later images. Caution: blocks the debugger; needs a full erase (`nrfutil device recover`) to undo; never on a dev build. |
| 5 | **Crypto / secure key storage** | Protect confidentiality; store keys/secrets securely. *(Part I)* | `CONFIG_NRF_SECURITY` / PSA + PSA ITS / Trusted Storage present / not present | Verify keys use the PSA crypto + secure-storage path, not raw keys in flash. |
| 6 | **TrustZone / TF-M** (ARMv8-M only) | Isolate security-critical code to reduce exploit impact. *(Part I)* | `CONFIG_BUILD_WITH_TFM` present / not present — **or N/A**. (TF-M is enabled by building the **`/ns` board target**, which sets this.) | **52-series (incl. nRF52840 = Cortex-M4, no TrustZone): N/A, not a gap.** TF-M applies on nRF5340 / nRF91 / nRF54L; the nRF54H uses a different security architecture. |
| 7 | **Memory protection** | Mitigate memory-corruption exploits. *(Part I)* | `CONFIG_ARM_MPU` / `CONFIG_HW_STACK_PROTECTION` / `CONFIG_STACK_SENTINEL` present / not present | Verify MPU + stack protection suit your part. |
| 8 | **Logging hygiene** | Don't leak secrets; minimise sensitive data in logs. *(Part I)* | `CONFIG_LOG` config + heuristic grep of `src/` for secrets in `LOG_*`/`printk` | Heuristic — review any flagged lines yourself; confirm no secrets are logged. |
| 9 | **Shell/console in production** | Don't ship an interactive debug surface in production. *(Part I)* | `CONFIG_SHELL` on a UART/console backend present / not present | If this is a production build, verify the shell/console is disabled. |
| 10 | **SBOM generated** | Identify & document components (the named machine-readable SBOM). *(Part II — vulnerability handling)* | this run produced `compliance/sbom/` (yes / no) | Generated by the SBOM step; keep it updated when components change. |

> **Secure boot (#1) is a multi-image feature — confirm the bootloader was actually built.**
> `CONFIG_BOOTLOADER_MCUBOOT` lives in the **application image's** merged `.config`; if it shows `not set`
> there, MCUboot is not chained for the app even when `CONFIG_SECURE_BOOT` (B0/NSIB) or
> `CONFIG_NCS_MCUBOOT_IN_BUILD` appear. A real secure-boot sysbuild builds a **separate `mcuboot`/`b0`
> sub-image** — confirm it exists (in the build log or a `build/mcuboot` / `build/b0` dir). If only the app
> image + `merged.hex` were produced, report it **neutrally** ("requested in `prj.conf` but the bootloader
> sub-image is not present in this build — verify"), and never invent a "child image" the build didn't produce.
>
> **Enabling it (recipe + change-impact, for a fix you start):** set it at the **sysbuild** level —
> `sysbuild.conf` → `SB_CONFIG_BOOTLOADER_MCUBOOT=y` (NCS ≥ 2.7). App-level `CONFIG_BOOTLOADER_MCUBOOT=y`
> **alone does NOT build the bootloader child image** — it only marks the app as chain-loaded. Surface two
> caveats to the dev: (a) a bootloader **changes the flash partition map** — for an **already-deployed**
> product pin a static layout (`pm_static.yml`) so an OTA matches fielded devices; (b) the build signs with a
> **debug key** by default (`root-rsa-2048.pem`) — swap in your own before production. If the project already
> stages MCUboot configs (e.g. `*_sr_net.conf`), prefer/offer **those** rather than hand-rolling a different
> flavour.

## "Worth doing now" — dependency order (not just severity)
1. **MCUboot (secure boot)** — the root; signed updates depend on it.
2. **Signed FOTA/DFU** — once the bootloader verifies images.
3. **APPROTECT lock** + **TF-M** (5340/91/54) — surface + isolation.
4. **Secure storage / crypto**, then memory protection, logging hygiene, shell-off.

> Verification status: the Kconfig→requirement mappings are best-effort and pending an expert pass. Treat as a
> *preview*, not an audit. The Part I/Part II labels are coarse (the public regulation's two halves); finer
> clause mapping ships only after expert validation.
