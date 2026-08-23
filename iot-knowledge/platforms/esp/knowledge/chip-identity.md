---
id: adsum/esp/knowledge/chip-identity
title: "Reference: ESP32 Chip Identity"
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
platform: esp
min_ext: "0.3.0"
---

# Reference: ESP32 Chip Identity (platforms/esp/knowledge/chip-identity.md)

One row per ESP32 target: what `CONFIG_IDF_TARGET` says, what the part is called, which CPU
architecture it has, and therefore which cross-toolchain binary its addresses decode with.

This is a **catalogue**, not a configuration check. Espressif ships new targets between our releases,
which is why it lives in a bit that can be republished rather than in the extension — a name table
should never need a reinstall. What a *specific build* actually enabled is a different question, and
`sdkconfig` is the only honest answer to it: read the symbol, do not infer it from the part number.

## The table

```yaml
# arch and addr2line are properties of the silicon — safe to rely on.
# memprot is the mode ESP-IDF selects by default on that target; `verify` means read the symbol
# rather than assume, because the default is decided by SOC capability flags and has moved between
# IDF versions. The gate is always CONFIG_ESP_SYSTEM_MEMPROT; the mode is
# CONFIG_ESP_SYSTEM_MEMPROT_PMS / _PMP / _TEE.
chips:
  - target: esp32
    name: ESP32
    arch: xtensa
    addr2line: xtensa-esp32-elf-addr2line
    memprot: verify        # depends on SOC_CPU_IDRAM_SPLIT_USING_PMP / SECURE_ENABLE_TEE / SOC_MEMPROT_SUPPORTED
    secure_boot: v1, v2 (v2 on ECO3 and later silicon)
  - target: esp32s2
    name: ESP32-S2
    arch: xtensa
    addr2line: xtensa-esp32s2-elf-addr2line
    memprot: pms
    secure_boot: v2
  - target: esp32s3
    name: ESP32-S3
    arch: xtensa
    addr2line: xtensa-esp32s3-elf-addr2line
    memprot: pms           # "Permission Control", per the S3 security guide
    secure_boot: v2
  - target: esp32c2
    name: ESP32-C2 (ESP8684)
    arch: riscv32
    addr2line: riscv32-esp-elf-addr2line
    memprot: verify
    secure_boot: v2
  - target: esp32c3
    name: ESP32-C3
    arch: riscv32
    addr2line: riscv32-esp-elf-addr2line
    memprot: pmp
    secure_boot: v2
  - target: esp32c5
    name: ESP32-C5
    arch: riscv32
    addr2line: riscv32-esp-elf-addr2line
    memprot: verify
    secure_boot: v2
  - target: esp32c6
    name: ESP32-C6
    arch: riscv32
    addr2line: riscv32-esp-elf-addr2line
    memprot: pmp
    secure_boot: v2
  - target: esp32c61
    name: ESP32-C61
    arch: riscv32
    addr2line: riscv32-esp-elf-addr2line
    memprot: verify
    secure_boot: v2
  - target: esp32h2
    name: ESP32-H2
    arch: riscv32
    addr2line: riscv32-esp-elf-addr2line
    memprot: verify
    secure_boot: v2
  - target: esp32p4
    name: ESP32-P4
    arch: riscv32
    addr2line: riscv32-esp-elf-addr2line
    memprot: verify
    secure_boot: v2
```

## How to read it

**`CONFIG_IDF_TARGET` in `sdkconfig` is the identity.** Not the board name, not the module marking:
a DevKitC, a XIAO and a custom board can all be `esp32c6`. `idf.py set-target` writes it, and
`build/config/sdkconfig.json` carries it for anything reading the build rather than the source.

**The architecture decides the toolchain, and only the Xtensa parts differ per chip.** Every RISC-V
target shares `riscv32-esp-elf`; each Xtensa target has its own. Getting this wrong produces
`file:line` output that looks plausible and is wrong — the `decode-fault` Tool bit picks the prefix
from this table so nobody has to remember it.

**The fault frame differs by architecture too.** Xtensa panics print `Backtrace: 0x…:0x…` — those are
`PC:SP` *pairs* and addr2line takes them verbatim. RISC-V prints no backtrace by default: decode
`MEPC` (the crash PC) and `RA` (the caller).

**`memprot: verify` is not a gap in the table, it is the honest answer.** Which mode a target
defaults to is decided by SOC capability flags and has changed between IDF versions, so for those
parts the only sound statement is what the build itself says. Read
`CONFIG_ESP_SYSTEM_MEMPROT` (the gate) and `CONFIG_ESP_SYSTEM_MEMPROT_PMS` / `_PMP` / `_TEE` (the
mode) out of `sdkconfig`, and report the symbol you found rather than the one the part number
suggests.

**Secure Boot is v2 everywhere except the original ESP32**, which shipped v1 first and gained v2 with
ECO3 silicon. A build's actual state is `CONFIG_SECURE_BOOT` plus `CONFIG_SECURE_BOOT_V2_ENABLED` —
again, read it, and remember that enabling it in `sdkconfig` is not the same as having burned the
eFuse.
