<div align="center" markdown="1">

<img src="assets/icons/icon.png" width="110" alt="Adsum IoT Coder" />

# Adsum IoT Coder

### ESP &amp; nRF · IoT Firmware Debug, Dev &amp; CRA Readiness

**An IoT coding agent for VS Code that works your whole firmware dev loop on Espressif ESP and Nordic nRF: scaffold, build, flash, test, observe, fix. It automates the routine firmware work you would rather not do, and cracks the runtime bugs general agents cannot, because it reads your board, not just your code.**

**What makes it different is real human expertise, not just the AI model.** Adsum is augmented with curated firmware knowledge authored by engineers who have shipped, loaded on demand and validated by an [open benchmark](#benchmark) on real hardware. Human-curated, not AI-generated.

**Shipping today:** Espressif ESP32 (incl. S3, C6) on ESP-IDF · Nordic nRF52 / nRF53 / nRF54L / nRF91 on nRF Connect SDK (Zephyr) · BLE, Wi-Fi, and cellular (NB-IoT, LTE-M, GNSS) · **one-click EU Cyber Resilience Act (CRA) readiness: an SBOM plus a secure-by-design posture check.** Open source under Apache 2.0.

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger"><img src="https://badgen.net/vs-marketplace/i/AdsumNetwork.nrf-ai-debugger?label=VS%20Code&color=007ACC" alt="VS Code Marketplace installs"></a>
  <a href="https://open-vsx.org/extension/AdsumNetwork/nrf-ai-debugger"><img src="https://badgen.net/open-vsx/d/AdsumNetwork/nrf-ai-debugger?label=Open%20VSX&color=C160EF" alt="Open VSX installs"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-D76947" alt="License"></a>
  <a href="https://github.com/adsumnetworks/Adsum-IoT-Coder/discussions"><img src="https://img.shields.io/badge/Community-discussions-D76947" alt="Discussions"></a>
  <a href="https://www.youtube.com/@adsumnetworks"><img src="https://img.shields.io/badge/YouTube-watch-FF0000?logo=youtube&logoColor=white" alt="YouTube"></a>
</p>

**[Install →](#getting-started)** · **[Docs →](https://docs.adsumnetworks.com)** · **[CRA readiness →](#cra-readiness-sbom-cve-and-secure-by-design)** · **[Benchmark →](#benchmark)** · **[Contribute →](#contributing)**

<a href="https://www.youtube.com/playlist?list=PLYh65pF22Elk" target="_blank" rel="noopener noreferrer"><img src="assets/docs/hero.gif" width="100%" alt="Adsum IoT Coder building and debugging ESP32 and nRF firmware in VS Code" /></a>

**[▶ Watch an industrial dual-chip gateway (BLE + Wi-Fi) built, debugged, and CRA-checked in under 30 minutes →](https://www.youtube.com/playlist?list=PLYh65pF22Elk)** · **[Read the walkthrough →](https://docs.adsumnetworks.com/ble-wifi-gateway)**

**No key, no account, no card.** The free tier is on by default: install and see it work on a real bug in your first minute.

</div>

---

> **On our open benchmark, running the identical model as Claude Code (Claude Haiku 4.5), Adsum fixed 4× more firmware bugs on the first device flash, at 3.8× fewer tokens on average and up to 13× on individual tasks. Anyone can rerun it.**

<p align="center"><img src="docs/benchmarks/assets/figure3.png" width="78%" alt="Token consumption per task: Adsum IoT Coder vs Claude Code on the same model" /></p>

## What's New <sup>`v0.3.1`</sup>

Cellular silicon, the first composable gateway, and tools that update without a release.

<img src="assets/icons/whatsnew-detect.png" width="18" valign="middle" alt="" /> &nbsp;**Cellular.** nRF9160, nRF9161 and nRF9151 boards, with NB-IoT, LTE-M and GNSS. Two new tools talk to the modem: a board shell for AT and Zephyr commands, and a modem trace that reports why a connection failed. DECT NR+ and NTN knowledge ships too, though both need modem firmware you cannot download. [Cellular on nRF91](https://docs.adsumnetworks.com/cellular)

<img src="assets/icons/whatsnew-esp.png" width="18" valign="middle" alt="" /> &nbsp;**Gateways as products.** A gateway is a base, a radio card and an enclosure that have to agree, and the part printed on a card is not always the part fitted. The Fanstel LEW840X is the first product with its own knowledge: which card carries which radio, which connector programs which chip. [Partner open hardware](https://docs.adsumnetworks.com/supported-hardware/partner-open-hardware)

<img src="assets/icons/whatsnew-knowledge.png" width="18" valign="middle" alt="" /> &nbsp;**Tools update themselves.** The loggers, the BLE sniffer, the decoders and the CRA scan engine are now Tool bits: versioned, credited, and hash-verified before they run. A fix reaches you without an extension update. [Device tools](https://docs.adsumnetworks.com/device-tools) · [how delivery works](https://docs.adsumnetworks.com/knowledge-bits)

**In `v0.2.1`:** project memory, longer sessions, and log search that took one capture from 333,000 tokens to a few thousand. **In `v0.2.0`:** a two-chip industrial gateway built, debugged and CRA-checked from one spec **in under 30 minutes**, the build this release makes composable. **[Watch the playlist](https://www.youtube.com/playlist?list=PLYh65pF22Elk)** · *full history in the [changelog](./CHANGELOG.md).*

## Why it exists

Adsum does not replace the embedded engineer, it accelerates them. Embedded firmware work is two jobs at once: routine setup you would rather automate, and a handful of genuinely hard bugs that live outside the source file. General agents help with neither, because both need the board, not just the code.

What makes it good at the hard parts is the part general agents do not have: **real human expertise**, curated by engineers who have shipped, loaded on demand, and validated on real hardware. [Why it exists →](https://docs.adsumnetworks.com/why-it-exists) · [How it works →](https://docs.adsumnetworks.com/architecture)

## What it does: debug, build, and prototype ESP and nRF firmware

- **Detects your platform.** nRF, ESP, both, or a fresh start, with the right tools for each.
- **Carries a full product build.** One spec to a working two-chip gateway, across both toolchains, in under 30 minutes with you approving each step. [Watch the playlist](https://www.youtube.com/playlist?list=PLYh65pF22Elk) · [walkthrough](https://docs.adsumnetworks.com/ble-wifi-gateway)
- **Builds, flashes and debugs on real hardware.** Live logs over RTT and UART on nRF, serial on ESP, analysed against your source.
- **Debugs across three layers.** App log, HCI bus and over-the-air radio, correlated, so you see where a BLE flow actually broke. A guided sample needs no hardware.
- **Talks to the board directly.** AT and Zephyr shell commands, and a modem trace that reports the network's own reason for refusing a connection.
- **Scaffolds and extends.** A new nRF or ESP-IDF project, or a BLE service, sensor, shell or storage wired into your existing one.
- **Tests and validates.** Host tests and on-hardware checks.
- **Hands a session to your own agent (beta).** Export a session as one redacted file, or hand a running task over: Adsum brings the embedded knowledge and drives the toolchain while your agent does the work.

## Supported platforms: ESP32 / ESP-IDF and nRF / nRF Connect SDK

| Platform | Chips (today) | SDK | Protocols (today) |
|:---|:---|:---|:---|
| **Nordic** | nRF52, nRF53, nRF54L (L15, LM20), **nRF91 (9160, 9161, 9151)** | nRF Connect SDK (Zephyr) | BLE, **NB-IoT, LTE-M, GNSS** |
| **Espressif** | ESP32, ESP32-S3, ESP32-C6, and the rest of the shipping range | ESP-IDF | Wi-Fi, BLE |
| **Products** | **Fanstel LEW840X, BWG840** gateways, with their own product knowledge | both, one workspace | BLE, Ethernet, Wi-Fi |
| **Roadmap** | nRF7x (Wi-Fi), on-device AI on nRF54 / ESP32, Linux devices (NVIDIA Jetson, Raspberry Pi) | | LoRa, 5G / 5G RedCap via hats |

DECT NR+ and NTN knowledge ships today, but the hardware gates it: NTN needs an nRF9151 with the LACA A1A variant and its own modem firmware, and DECT NR+ needs an image from Nordic sales rather than a download. Adsum works on **any board built with a supported chip**: your own design, a reference board, a development kit, or a product off the shelf. There is no list your board has to be on. [Chips and protocols](https://docs.adsumnetworks.com/supported-hardware) · [cellular](https://docs.adsumnetworks.com/cellular) · [partner open hardware](https://docs.adsumnetworks.com/supported-hardware/partner-open-hardware)

CRA readiness (SBOM + secure-by-design posture) runs on both Nordic and Espressif builds.

## CRA Readiness: SBOM, CVE, and secure-by-design

One click runs a build-time readiness check for the **EU Cyber Resilience Act (CRA)**, on both nRF and ESP. A readiness snapshot to help you prepare, **not a conformity assessment and not legal advice.**

**[▶ Watch the CRA check run on a real gateway build →](https://www.youtube.com/watch?v=uwl76c6FuY0)**

- **An SBOM from your real build.** Machine-readable SPDX, the CRA's named artifact, generated with the vendor-native tools rather than guessed.
- **A known-CVE scan across it.** Your build's identifiable components (CPE/PURL) matched against EUVD, NVD and OSV, with coverage stated honestly. Never a pass/fail verdict.
- **A secure-by-design posture check** against your actual configuration: secure boot, signed updates, debug-port lock, secure pairing, secure storage, each with the plain-English requirement and the fix, biggest gap first.
- **Bring a CVE and close it.** It confirms the affected component is really in your build, links the advisory, then helps you bump, rebuild and regenerate.
- **Fix in the loop, not just flag.** Wire the top fix, rebuild and re-verify without leaving the agent.
- **Advisory data updates without a release.** The scan engine and its CVE tables are a Tool bit, so mappings that change weekly come from the registry.

It tells you which CRA date applies to you and writes a `compliance/` folder: report, JSON companion and SBOM. Run it on your firmware, or on a bundled sample with nothing open. [Full walkthrough](https://docs.adsumnetworks.com/cra-readiness)

<p align="center">
  <img src="assets/docs/cra-report.png" width="58%" alt="Adsum IoT Coder CRA readiness report (CRA_READINESS.md): the honest 'readiness aid, not a conformity assessment' header, an at-a-glance count of components, CVEs found, likely-not-reachable, and secure-by-design gaps, and the SBOM (SPDX) section, for the EU Cyber Resilience Act" />
</p>

## Benchmark

> **On our open benchmark, running the identical model as Claude Code (Claude Haiku 4.5), Adsum fixed 4× more firmware bugs on the first device flash, at 3.8× fewer tokens on average and up to 13× on individual tasks. Anyone can rerun it.**

Both agents ran the same model on real nRF52 hardware, so the gap measures architecture, not model power. Adsum IoT Coder closed 5 of 6 bugs versus Claude Code's 3, using 3.8× fewer tokens on average and as much as 13× fewer on the hardest individual tasks. The benchmark, IoT-FirmwareDebugBench v0.1, is open source. Run it yourself.

| Metric | Adsum IoT Coder | Claude Code |
|:---|:---|:---|
| Bugs closed (within 7 flashes) | **5 / 6** | 3 / 6 |
| Resolved on the first flash | **4 / 6** | 1 / 6 |
| Cross-device tasks (L3) | **1 / 2** | 0 / 2 |
| Tokens per resolved task | **1.86M** | 7.15M |

Full methodology, per-task results, and honest limitations are in the [benchmark report](./docs/benchmarks/v0.1-report.md). Methodology adapted from [arXiv:2603.19583](https://arxiv.org/abs/2603.19583).

## Getting Started

Search **Adsum IoT Coder** in the VS Code Extensions panel, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger) or [Open VSX](https://open-vsx.org/extension/AdsumNetwork/nrf-ai-debugger) (for Cursor, Windsurf and VSCodium). **No key, no account, no card**: the free tier is on by default, and it is a real working tier rather than a locked demo, enough to scaffold a project and run a full debug loop.

**Prerequisites:** the [nRF Connect Extension Pack](https://marketplace.visualstudio.com/items?itemName=nordic-semiconductor.nrf-connect-extension-pack) for nRF work, or an ESP-IDF installation for ESP. nRF54LM20 boards need nRF Connect SDK 3.3.0 or newer, and cellular work needs an nRF91 DK and a SIM. Full requirements are in the [docs](https://docs.adsumnetworks.com/getting-started).

1. Start with a **sample run**, no board needed: the 30-second BLE debug demo, or the CRA readiness check on a bundled sample.
2. Open your **nRF or ESP project**; the home reads it and detects your boards and toolchain.
3. Pick one of the proposed **workflow cards**: *Build/flash & debug*, *Add a feature*, *Test & validate*, or *CRA SBOM & Fix*.
4. **Bring your own model** whenever you want: the GLM Coding Plan, Claude, DeepSeek, or any OpenAI- or Anthropic-compatible endpoint, cloud or local. The switch is instant on a running task.

Field-tested on our own gateway builds: the budget tiers handle most routine work with thinking kept on, and the full models can switch it off, which is where the token saving lives. [Free tier →](https://docs.adsumnetworks.com/free-tier) · [Models and settings →](https://docs.adsumnetworks.com/models)

## Roadmap

**Next:** nRF7x Wi-Fi, and deeper integration of the on-device AI features of nRF54 and ESP32, so edge inference gets the same build, flash, observe, and fix loop as the rest of your firmware. Linux-based devices, including NVIDIA Jetson and Raspberry Pi, with cellular hats (5G, 5G RedCap, NTN) alongside nRF and ESP radios. More composable gateways: multi-radio bases pairing BLE 6.0 with LTE-M and NTN, and open-hardware designs adding LoRa, Wi-Fi and battery backup in an IP67 enclosure. And Adsum working inside your own coding agent, so you stay in the agent you prefer. The roadmap is shaped by what the community asks for and contributes. [Full roadmap](https://docs.adsumnetworks.com/platforms-and-roadmap)

## Contributing

The agent gets stronger as its curated knowledge grows, and there are two ways in. **Contribute knowledge** if you have shipped nRF or ESP firmware: the hard-won fixes and idioms that only come from real hardware, credited to you in every session that loads them. **Contribute code** to the extension itself, which is Apache-2.0.

[Contributing →](https://docs.adsumnetworks.com/contributing) · [Open an issue or PR](https://github.com/adsumnetworks/Adsum-IoT-Coder/issues) · [Start a discussion](https://github.com/adsumnetworks/Adsum-IoT-Coder/discussions)

## Honest limits, privacy and security

We publish what is true today. **Adsum is an AI-based coding agent and can make mistakes.** The CRA workflow is a readiness aid, not a conformity assessment and not legal advice; only a notified body or your formal assessment establishes conformity. The CVE scan covers components carrying identifiers (CPE/PURL) and **does not find undisclosed or zero-day vulnerabilities**. The benchmark is six BLE tasks on a single NCS version: a proof of concept, not statistical significance, with an ESP suite on the roadmap.

The runtime runs entirely on your machine, and so does your project memory: the `.adsum/` folder lives in your repo and is never uploaded. Only the log snippets and code context a task needs go to the AI provider you configure, and you choose which model and endpoint to trust. Analytics are pseudonymous product events only (installs, activations, feature usage, errors), keyed to a random install ID, never your source, chat or device logs. Opt out with `telemetry.telemetryLevel: off`. The source is open and auditable.

[Limitations in full](https://docs.adsumnetworks.com/legal/limitations) · [privacy and security](https://docs.adsumnetworks.com/privacy-and-security)

nRF, nRF Connect SDK and Nordic Semiconductor are trademarks of Nordic Semiconductor ASA; ESP32 and ESP-IDF are trademarks of Espressif Systems; Zephyr is a trademark of the Linux Foundation; Visual Studio Code is a trademark of Microsoft. This is an independent project, not affiliated with or endorsed by any of them.

## About

**[Adsum Networks](https://github.com/adsumnetworks)** has built embedded firmware on Nordic nRF and other SoC platforms for 8 years, living inside the failure modes that cost embedded engineers their days. We built Adsum IoT Coder because general coding agents leave embedded developers without reliable help for the work that fills the day: the routine setup worth automating, and the runtime bugs that never show up in source review. The difference is real human expertise, not just the AI model: curated firmware knowledge authored by engineers who have shipped, loaded on demand and measured against an open benchmark on real hardware, so the value can be defended, not just claimed.

---

<div align="center" markdown="1">

**Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger) or [Open VSX](https://open-vsx.org/extension/AdsumNetwork/nrf-ai-debugger) and see it work in your first minute. No key, no account.**

**[adsumnetworks.com](https://adsumnetworks.com)** · **[GitHub](https://github.com/adsumnetworks/Adsum-IoT-Coder)** · **[Discussions](https://github.com/adsumnetworks/Adsum-IoT-Coder/discussions)** · **[YouTube](https://www.youtube.com/@adsumnetworks)**

**Open-core:** extension code Apache-2.0 © 2026 Adsum Networks (a derivative of [Cline](https://github.com/cline/cline); see [NOTICE](NOTICE)) · bundled knowledge content CC-BY-SA-4.0 (see [iot-knowledge/LICENSE](iot-knowledge/LICENSE)) · downloaded registry bits are proprietary.

</div>
