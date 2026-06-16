<div align="center" markdown="1">

<img src="assets/icons/icon.png" width="110" alt="Adsum IoT Coder" />

# Adsum IoT Coder

### ESP &amp; nRF · AI Debug &amp; Dev

**One AI tool for the whole embedded inner loop on Espressif ESP and Nordic nRF: scaffold, build, flash, test, observe, fix. It automates the routine firmware work you would rather not do, and cracks the runtime bugs general agents cannot, because it reads your board, not just your code.**

**What makes it different is real human expertise, not just a model.** Adsum is augmented with curated firmware knowledge authored by engineers who have shipped, loaded on demand and validated by an open benchmark on real hardware. Human-curated, not AI-generated.

**Shipping today:** Espressif ESP32 (incl. S3, C6) on ESP-IDF · Nordic nRF52 / nRF53 / nRF54 on nRF Connect SDK (Zephyr) · BLE and Wi-Fi. Open source under Apache 2.0.

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-install-00A9CE?logo=visual-studio-code" alt="VS Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger"><img src="https://img.shields.io/visual-studio-marketplace/i/AdsumNetwork.nrf-ai-debugger?label=installs&color=00A9CE" alt="Installs"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://github.com/adsumnetworks/Adsum-IoT-Coder/discussions"><img src="https://img.shields.io/badge/community-discussions-00A9CE" alt="Discussions"></a>
  <a href="https://www.youtube.com/@adsumnetworks"><img src="https://img.shields.io/badge/YouTube-watch-FF0000?logo=youtube&logoColor=white" alt="YouTube"></a>
</p>

**[Watch the demo →](https://www.youtube.com/watch?v=67tUybg1phk)** · **[Install →](#getting-started)** · **[Docs →](https://adsumnetworks.com)** · **[Benchmark →](#benchmark)** · **[Contribute →](#contributing)**

<a href="https://www.youtube.com/watch?v=67tUybg1phk"><img src="assets/docs/hero.gif" width="100%" alt="Adsum IoT Coder demo: capture, analyze, fix" /></a>

</div>

---

> **vs Claude Code, same model (Claude Haiku 4.5): 5/6 vs 3/6 bugs closed on real nRF hardware, at 3.8× fewer tokens on average and up to 13× on individual tasks. The edge is architecture, not model scale.**

## What's New <sup>`v0.1.6`</sup>

**One extension, now for ESP32 too.** Build, flash, monitor, and test ESP-IDF firmware with the same guided workflows you use for nRF.
**Automatic platform detection.** The home reads whether your workspace is nRF, ESP, both, or a fresh start, and routes every workflow and the agent's expertise accordingly.
**Prototyping for both.** *Start a prototype* now scaffolds complete ESP-IDF projects too.
**Always-current knowledge, leaner install.** Platform expertise is delivered on demand and cached locally, so guidance stays fresh.
**Stronger Windows support.** Board and toolchain detection across real install layouts, verified on real nRF and ESP hardware.

*Full history in the [changelog](./CHANGELOG.md).*

## Why it exists

Embedded firmware work is two jobs at once: a lot of routine, repetitive setup, and a handful of genuinely hard problems. General coding agents help with neither well, because both live outside the source file.

**The routine you would rather automate:** scaffolding a project, wiring devicetree and Kconfig, generating logging, adding a BLE service or a sensor, writing tests, bringing up a new board. Adsum does this work for you, idiomatically, on both ESP and nRF.

**The hard bugs you cannot grep:** a missing `settings_load()` after `bt_enable()` that silently breaks notifications after a reconnect; an ESP-IDF partition mismatch that only fails at runtime; a fault visible only by correlating logs across two boards. Adsum reads the device, captures the live logs, and works them the way a senior engineer does.

And the reason it is good at the hard parts is the part general agents do not have: **real human expertise.** The firmware knowledge that drives it is authored by engineers who have shipped, loaded on demand, and validated against an open benchmark. Human-curated, not AI-generated.

## What it does

- **Automatic platform detection.** nRF, ESP, both, or a fresh start, with the right tools for each.
- **Build, flash & debug.** The full loop on real hardware: build, flash, capture live logs (RTT/UART on nRF, serial monitor on ESP), analyze, fix, repeat.
- **Capture & analyze device logs.** Correlated with your source, across one board or two.
- **Start a prototype, add a feature.** Scaffold a new nRF or ESP-IDF project; wire a BLE service, sensor, shell, or storage into your real project.
- **Test & validate.** Host tests and on-hardware checks.

<p align="center">
  <img src="assets/docs/home-project-open.png" width="340" alt="The guided home with workflow cards" />
</p>

## Supported platforms

| Platform | Chips (today) | SDK | Protocols (today) |
|:---|:---|:---|:---|
| **Nordic** | nRF52, nRF53, nRF54 | nRF Connect SDK (Zephyr) | BLE |
| **Espressif** | ESP32, ESP32-S3, ESP32-C6 | ESP-IDF | Wi-Fi, BLE |
| **Roadmap** | nRF7x (Wi-Fi), nRF9x (cellular) | | Thread, Matter, LTE-M |

## Benchmark

> **Adsum IoT Coder vs Claude Code, same model (Claude Haiku 4.5): 5/6 vs 3/6 bugs, 3.8× more token-efficient on average and up to 13× on individual tasks.**

Both agents ran the same model on real nRF52 hardware, so the gap measures architecture, not model power. Adsum IoT Coder closed 5 of 6 bugs versus Claude Code's 3, using 3.8× fewer tokens on average and as much as 13× fewer on the hardest individual tasks. The benchmark, IoT-FirmwareDebugBench v0.1, is open source. Run it yourself.

| Metric | Adsum IoT Coder | Claude Code |
|:---|:---|:---|
| Bugs closed (within 7 flashes) | **5 / 6** | 3 / 6 |
| Resolved on the first flash | **4 / 6** | 1 / 6 |
| Cross-device tasks (L3) | **1 / 2** | 0 / 2 |
| Tokens per resolved task | **1.86M** | 7.15M |

<p align="center"><img src="docs/benchmarks/assets/figure3.png" width="92%" alt="Token consumption per task: Adsum vs Claude Code, same model" /></p>

Full methodology, per-task results, and honest limitations are in the [benchmark report](./docs/benchmarks/v0.1-report.md).

## Getting Started

Search **Adsum IoT Coder** in the VS Code Extensions panel, or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger) directly. No key, no account: the free tier is on by default.

1. Run the built-in **30-second demo** (no board needed) to see the capture, analyze, fix loop on a real BLE bug.
2. Open your **nRF or ESP project**; the home reads it, detects your boards and toolchain, and offers the right one-click workflows.
3. Bring your own model whenever you want; the running task continues, no restart.

## Free tier: put it to work in your first minute, on us

Most tools make you choose a provider, paste an API key, and add a card before you can find out whether they help. We cut all of that.

Install Adsum IoT Coder and it just works. No key, no account, no card. The inference is on us, on a managed model, so you can point the agent at your own firmware in the first minute, not the first hour. It is a real working tier, generous enough to scaffold a project and run a full debug loop, not a locked demo.

When you want your own model or heavier usage, drop in any OpenAI-compatible key (Claude, DeepSeek, or a local model with strong tool-calling) and the switch is instant: the task you are in keeps running, no restart. The free tier is token-metered, and when you reach the limit a one-click prompt moves you onto your own key and the same task picks up exactly where it left off.

|  | Free tier | Bring your own key |
|:---|:---|:---|
| **API key** | Not required | Required |
| **Cost to you** | Nothing, the inference is on us | Your provider's rates |
| **Model** | Managed by Adsum | Any OpenAI-compatible model |
| **Best for** | First run, evaluation, quick fixes | Daily driver, long sessions, model choice |

Recommended for bring-your-own-key: **Claude Haiku 4.5** (the benchmark model) and **DeepSeek-V4-Pro** (cost-effective long sessions). Full setup and tested models in the [docs](https://adsumnetworks.com).

## Contributing

Adsum gets better in two ways, and both are open to you.

**Contribute knowledge (embedded experts and specialists).** The curated firmware knowledge is what makes the agent good. Author a knowledge module (a Markdown workflow, board, or protocol file under `iot-knowledge/`) and you are credited in it. You keep the rights to what you author and choose how it is licensed. [Start a discussion](https://github.com/adsumnetworks/Adsum-IoT-Coder/discussions) to become a founding contributor.

**Contribute code (open-source developers).** The extension is open source (Apache-2.0, built on [Cline](https://github.com/cline/cline)). Improve the tool itself, or add a benchmark task in [`evals/`](./evals/). [Open an issue or PR](https://github.com/adsumnetworks/Adsum-IoT-Coder/issues).

## Roadmap

Shipping today: Nordic nRF and Espressif ESP32, with BLE and Wi-Fi. Next: more chips (nRF7x Wi-Fi, nRF9x cellular, more ESP32 variants), more protocols (Thread, Matter, LTE-M), deeper hardware-in-the-loop tooling (BLE sniffer, power profiling), and a growing community knowledge base. The roadmap is shaped by what the community asks for and contributes.

## Limitations

We publish what is true today. The benchmark is six BLE tasks on a single NCS version: a proof of concept, not statistical significance, and an ESP benchmark suite is on the roadmap (v0.2). nRF and Nordic Semiconductor are trademarks of Nordic Semiconductor ASA; ESP32 and ESP-IDF are trademarks of Espressif Systems. This is an independent project, not affiliated with or endorsed by either.

## Privacy & Security

The runtime runs entirely on your machine. Only the log snippets and code context a task needs go to the AI provider you configure. BYOK: you control which model and endpoint you trust. Pseudonymous product analytics only (installs, activations, feature usage, errors), keyed to a random install ID; never your source code, chat content, or device logs. Opt out anytime with `telemetry.telemetryLevel: off`. Source is fully open and auditable.

## About

**[Adsum Networks](https://github.com/adsumnetworks)** builds connected-device firmware and the tools to ship it, with years spent inside the failure modes that cost embedded engineers their days. We built Adsum IoT Coder because general coding agents leave embedded developers without reliable help for the work that fills the day: the routine setup worth automating, and the runtime bugs that never show up in source review. Domain-specific AI has to be built by engineers who have lived inside the failure modes, and measured against open benchmarks so the value can be defended, not just claimed.

Built on [Cline](https://github.com/cline/cline). Benchmark methodology inspired by [arXiv:2603.19583](https://arxiv.org/abs/2603.19583).

---

<div align="center" markdown="1">

**[adsumnetworks.com](https://adsumnetworks.com)** · **[GitHub](https://github.com/adsumnetworks/Adsum-IoT-Coder)** · **[Discussions](https://github.com/adsumnetworks/Adsum-IoT-Coder/discussions)** · **[YouTube](https://www.youtube.com/@adsumnetworks)**

Apache 2.0 © 2026 Adsum Networks

</div>
