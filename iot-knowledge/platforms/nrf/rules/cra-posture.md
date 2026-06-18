---
id: adsum/nrf/rules/cra-posture
title: CRA Secure-by-Design Posture (nRF)
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

# CRA Secure-by-Design Posture — nRF (platforms/nrf/rules/cra-posture.md)

The secure-by-design **posture preview** for nRF/Zephyr. Each check reads **real build evidence** and
produces a status + a **plain-English requirement** + a suggested action. This is the spine of the CRA
Readiness Check, dated **"11 Dec 2027 essential requirements — worth doing now."**

## Overview
- **Read the merged config, not `prj.conf`.** Evaluate against `build/<target>/zephyr/.config` (board
  defaults + overlays + `prj.conf`). `prj.conf` alone misses everything inherited. If no build exists,
  say so and offer a build (don't guess).
- **Honest statuses only:** ✅ = "configured/present" (never "correct/done") · ⚠️ = "review" (heuristic /
  necessary-but-not-sufficient) · ❌ = "not found". A board-dependent check that doesn't apply is **N/A**,
  never a fail. Use **only** these symbols in the status column — **not** "Strong / Good / Partial / Weak /
  Pass" (those read as conformity grades, which this preview must never give).
- **Never write that a setting "meets / satisfies the requirement."** State the evidence + status; the
  reader's notified body decides conformity. "✅ LE Secure Connections configured" — yes; "meets the CRA
  state-of-the-art requirement" — no.
- **Verify the positive, not just the negative.** A ✅ requires the check's **named evidence symbol
  present** in the merged `.config`. If it shows `not set` (e.g. `# CONFIG_BOOTLOADER_MCUBOOT is not
  set`), it is **not** a ✅ — no matter what *adjacent* symbols (`CONFIG_SECURE_BOOT`,
  `CONFIG_NCS_MCUBOOT_IN_BUILD`) suggest. Don't narrate a pass the config contradicts. (A real run
  stamped secure boot ✅ on a build where `CONFIG_BOOTLOADER_MCUBOOT` was not set and no bootloader
  image was built.)
- **Chip applicability is real evidence too.** TrustZone-M / TF-M exists only on ARMv8-M Cortex-M33
  parts — **nRF5340, nRF91, nRF54L/H**. The **nRF52 series (incl. nRF52840) is Cortex-M4 with no
  TrustZone** → check #6 is **N/A** there, never ❌. Never describe a 52-part as "Cortex-M4 with
  TrustZone" (a real run did, and graded an inapplicable gap).

> **Requirement citations are plain-English — this is a HARD rule, not a v0.1 caveat.** Do **not** put CRA
> **Annex I clause letters or article numbers** in the report (e.g. "Annex I 2.(d)", "Art. 14(8)"). The exact
> Annex/clause/article + **EN 18031** mapping is pending expert validation, and guessed citations are
> frequently wrong (essential requirements are Art. 13 + Annex I, *not* Art. 14 — which is incident
> reporting). Cite each requirement in **plain language** until the validated mapping ships.

## The checks (evidence → status → requirement → action)

| # | Check | Evidence (merged `.config`) | Plain-English CRA requirement | If missing → suggested action |
|---|---|---|---|---|
| 1 | **Secure boot** | `CONFIG_BOOTLOADER_MCUBOOT=y` | Boot only verified, signed firmware (integrity + secure update root of trust). | Add MCUboot (the root dependency — do this **first**). |
| 2 | **Signed update / FOTA** | `CONFIG_MCUMGR*`, SMP/BT DFU, or nRF Cloud FOTA | Ship security updates over the support period, integrity-protected. | Enable DFU/FOTA **after** MCUboot (signed images need the bootloader). |
| 3 | **BLE pairing security** | `CONFIG_BT_SMP=y` + LE Secure Connections (`*_SC_*`) + bonding; flag Just-Works / fixed passkey | Authenticated, confidential pairing; no unauthenticated access. | Enable LE Secure Connections + bonding; avoid fixed passkeys. |
| 4 | **Debug-port lock (production)** | `CONFIG_NRF_APPROTECT_LOCK=y` | Limit the attack surface — lock the debug access port in production. | Lock APPROTECT for **production** builds. ⚠️ Irreversible at runtime — blocks the debugger and needs a full erase (`nrfutil`/`--recover`) to undo; never apply to a dev/debug build. |
| 5 | **Crypto / secure key storage** | `CONFIG_NRF_SECURITY` / PSA + key storage (PSA ITS / Trusted Storage) | Protect confidentiality; store keys/secrets securely. | Use the PSA crypto + secure storage path, not raw keys in flash. |
| 6 | **TrustZone / TF-M** (ARMv8-M only — 5340/91/54) | `CONFIG_BUILD_WITH_TFM=y` | Isolate security-critical code to reduce exploit impact. | **On 52-series (incl. nRF52840 = Cortex-M4, no TrustZone): N/A, never ❌.** Build with TF-M only on nRF5340/91/54. |
| 7 | **Memory protection** | `CONFIG_ARM_MPU`, `CONFIG_HW_STACK_PROTECTION`, `CONFIG_STACK_SENTINEL` | Mitigate memory-corruption exploits. | Enable MPU + stack protection. |
| 8 | **Logging hygiene** | `CONFIG_LOG` config + heuristic grep of `src/` for secrets in `LOG_*`/`printk` | Don't leak secrets; minimise sensitive data in logs. | ⚠️ review flagged lines (heuristic — confirm manually). |
| 9 | **Shell/console in production** | `CONFIG_SHELL=y` on a UART/console backend in a production build → flag | Don't ship an interactive debug surface in production. | Disable the shell/console for production builds. |
| 10 | **SBOM generated** | this run produced `compliance/sbom/` | Identify & document components (machine-readable SBOM). | Generated by the SBOM step. |

> **Secure boot (#1) is a multi-image feature — confirm the bootloader was actually built.**
> `CONFIG_BOOTLOADER_MCUBOOT` lives in the **application image's** merged `.config`; if it shows
> `not set` there, MCUboot is not chained for the app even when `CONFIG_SECURE_BOOT` (B0/NSIB) or
> `CONFIG_NCS_MCUBOOT_IN_BUILD` appear. A real secure-boot sysbuild builds a **separate `mcuboot`/`b0`
> sub-image** — confirm it exists (in the build log or a `build/mcuboot` / `build/b0` dir). If only the
> app image + `merged.hex` were produced, report **⚠️ review** ("requested in `prj.conf` but not present
> in this build"), never ✅ — and never invent a "child image" the build didn't produce.

## "Do these first" — dependency order (not just severity)
1. **MCUboot (secure boot)** — the root; signed updates depend on it.
2. **Signed FOTA/DFU** — once the bootloader verifies images.
3. **APPROTECT lock** + **TF-M** (53/91) — surface + isolation.
4. **Secure storage / crypto**, then memory protection, logging hygiene, shell-off.

> Verification status: the Kconfig→requirement mappings are best-effort and pending an expert pass
> (Pashley / VivaTech). Treat as a *preview*, not an audit.
