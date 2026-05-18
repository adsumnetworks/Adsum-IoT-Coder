<div align="center">

<img src="assets/icons/icon.png" width="120" alt="Adsum IoT Coder" />

# Adsum IoT Coder – for nRF

**An AI coding agent purpose-built for IoT firmware development.**
Hardware-in-the-loop log capture, native nRF Connect SDK integration,
and expert-reviewed IoT engineering knowledge loaded on demand —
backed by an open benchmark that measures it against general agents
on real hardware bugs.

200+ installs · Apache 2.0 · Built by IoT engineers, validated on real hardware

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger"><img src="https://img.shields.io/visual-studio-marketplace/v/AdsumNetwork.nrf-ai-debugger?label=VS%20Code%20Marketplace&logo=visual-studio-code&color=0078d4" alt="VS Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger"><img src="https://img.shields.io/visual-studio-marketplace/i/AdsumNetwork.nrf-ai-debugger?label=installs&color=0078d4" alt="Installs"></a>
  <a href="https://github.com/adsumnetworks/SoC-AI-Debugger/stargazers"><img src="https://img.shields.io/github/stars/adsumnetworks/SoC-AI-Debugger?style=flat&color=ffd700" alt="GitHub stars"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://github.com/adsumnetworks/SoC-AI-Debugger/discussions"><img src="https://img.shields.io/badge/community-discussions-blue" alt="Discussions"></a>
  <img src="https://img.shields.io/badge/nRF%20Connect%20SDK-v3.2.1-00A9CE" alt="NCS">
  <img src="https://img.shields.io/badge/Zephyr%20RTOS-compatible-blueviolet" alt="Zephyr">
</p>

**[Install →](#getting-started)** · **[Benchmark →](#benchmark--iot-firmwaredebugbench-v01)** · **[Architecture →](#architecture--dynamic-knowledge--tool-skill-loading)** · **[Roadmap →](#roadmap)**

<!-- TODO: Replace with updated demo GIF showing "Adsum IoT Coder" branding -->
<p><img src="assets/docs/demo.gif" width="100%" alt="Adsum IoT Coder Demo" /></p>

</div>

---

## Contents

1. [Why Adsum IoT Coder exists](#why-adsum-iot-coder-exists)
2. [Architecture — Dynamic Knowledge & Tool-Skill Loading](#architecture--dynamic-knowledge--tool-skill-loading)
3. [Benchmark — IoT-FirmwareDebugBench v0.1](#benchmark--iot-firmwaredebugbench-v01)
4. [Getting Started](#getting-started)
5. [Roadmap](#roadmap)
6. [Limitations](#limitations)
7. [Citing this work](#citing-this-work)
8. [About](#about)
9. [Privacy & Security](#privacy--security)
10. [Troubleshooting](#troubleshooting)

---

## Why Adsum IoT Coder exists

Embedded firmware debugging fails for general-purpose coding agents — not because the models lack capability, but because the problems live outside the source code. Diagnosing a BLE connection that won't pair, a current spike during a sensor read, or a settings store that silently loses CCCD state across reboots requires capabilities general agents don't have:

- **Native SDK integration.** nRF Connect SDK shells, Zephyr build systems, devicetree overlays, and Kconfig dependency chains aren't text the agent reads — they're tools the agent has to drive. General agents read source; they don't speak NCS.
- **Hardware-in-the-loop instrumentation.** Live RTT/UART log capture, J-Link board control, BLE sniffer correlation (Wireshark / nRF Sniffer), power profiler integration (PPK II), spectrum analysis. These are not files in your repo. They are physical signals from the chip, and most failures only show themselves there.
- **Expert-reviewed IoT engineering knowledge.** Curated BLE / Thread / Matter / WiFi protocol specs, IoT system architecture patterns, low-power optimization techniques, and an anti-pattern library distilled from thousands of real failed firmware attempts and support tickets. The kind of "I've seen this exact failure mode before" recognition that takes a senior embedded engineer years to build.
- **Tool-use skills tuned for IoT workflows.** Knowing *when* to flash vs. recheck logs vs. spin up a sniffer is itself expertise. General agents either skip log capture entirely (diagnosing from source — fine for web apps, broken for runtime bugs) or burn token budget exploring wrong hypotheses until context degrades.

Without these, general agents end up diagnosing IoT firmware from source code alone. That works for web applications, where runtime behavior is mostly explained by the code. It fails for firmware, where the same source compiles to wildly different runtime behavior depending on which Kconfig flags landed, which devicetree overlay applied, which bond state the device booted with, and what the radio environment looked like at the moment of failure.

A `settings_load()` call missing after `bt_enable()` compiles fine, connects fine, and silently breaks GATT notifications after reconnect. An advertising filter with an empty accept list makes the device scannable but impossible to connect to — with zero errors in the log. A Central/Peripheral connection-parameter mismatch only surfaces when you correlate timestamps across two separate log streams. None of these are visible in the source code; all of them are common in real projects.

Adsum IoT Coder is built on the four pillars above. The result is an agent that catches the bugs general agents can't see, surfaces code-level weaknesses and anti-patterns, optimizes for stable and low-power communication, and proposes architectural improvements grounded in expert-reviewed IoT practice — at a fraction of the token budget general agents consume getting nowhere.

---

## Architecture — Dynamic Knowledge & Tool-Skill Loading

### From proof of concept to platform

Two months ago we shipped nRF AI Debugger as a proof of concept to test whether purpose-built AI tooling could meaningfully outperform general coding agents on embedded firmware. 200+ installs in two months confirmed the demand. But v1's architecture loaded its full domain expertise into every session — a static bundle that worked but couldn't grow. Adding nRF53 support meant expanding the bundle. Adding ESP, Thread, or Matter meant the same. The architecture sat on a cliff edge.

This release inverts that. Domain knowledge and tool-use skills are structured as a framework of discrete, composable modules — each scoped to a specific chip family, protocol stack, or debug capability. At session start, the agent assesses what the project is and what the task requires, then fetches the relevant modules on demand.

```
iot-knowledge/
├── rules/                        # Platform-agnostic agent constraints
│   ├── core.md                   # Universal embedded development rules
│   ├── tool-routing.md           # When to use nRF terminal vs standard shell
│   └── device-identity.md        # Never guess device roles from board type
├── platforms/nrf/
│   ├── PLATFORM.md               # Master index — what to load and when
│   ├── boards/                   # Per-SoC: nRF52840, nRF52832, nRF5340
│   ├── sdks/ncs/                 # NCS project structure, Kconfig, BLE stack
│   │   ├── protocols/BLE.md      # BLE-specific modules
│   │   └── SDK.md                # NCS-specific modules
│   ├── workflows/                # Entry-point sequences (start here)
│   │   ├── log-analyzer.md       # Capture → Analyze → Report
│   │   ├── log-generator.md      # Instrument firmware with LOG_* macros
│   │   └── debug-loop.md         # Build → Flash → Capture → Analyze → Fix
│   └── actions/                  # Subroutines (loaded by workflows only)
│       ├── capture-logs.md
│       ├── analyze-logs.md
│       ├── build.md
│       └── flash.md
```

Analyzing a UART log drop loads `log-analyzer.md` + `capture-logs.md` + `sdks/ncs/SDK.md`. Debugging a failed BLE connection on a two-board setup also pulls in `BLE.md`, `device-identity.md`, and the relevant board file — and nothing else. The model gets exactly what the task requires, no more.

What this enables:

- **Scalable chip and protocol support.** New chip families and protocol stacks add as modules, not as core changes. nRF52 ships today. nRF53, nRF91, nRF54 are designed to slot in. **Adsum IoT Coder – for ESP** is next on the roadmap. WiFi, Thread, Matter, LTE-M, and DECT NR+ are all designed to absorb into the same framework.
- **Composable tool-use skills.** Different log capture backend, build system, or flashing tool? Author the skill module; the agent loads it when the task calls for it.
- **Context proportional to task complexity.** No fixed-cost domain bundle eating context regardless of difficulty. On complex multi-cycle debug sessions, this is the difference between finishing the work and hitting context overflow.

---

## Benchmark — IoT-FirmwareDebugBench v0.1

> **5 of 6 tasks resolved vs. 3 of 6 for Claude Code. 3.8× more token-efficient. Same underlying model — Claude Haiku 4.5.**

A clean architecture is only useful if it produces measurably better outcomes. Standard SWE benchmarks don't exercise hardware-in-the-loop work, and there is no established public benchmark for AI agents on embedded firmware. We adapted methodology from recent research on expert-skill-augmented LLM evaluation for embedded code generation ([arXiv:2603.19583](https://arxiv.org/abs/2603.19583)) and built one for IoT firmware debugging — published open source as a deliverable equal in importance to the tool itself.

**[IoT-FirmwareDebugBench v0.1](./docs/benchmarks/v0.1-report.md)** runs on real nRF52840 DK and nRF52832 DK boards with NCS v3.2.1 (Zephyr 4.2.99). Six tasks across three difficulty levels, each with a precisely injected bug, defined reproduction procedure, and known correct fix.

The most important methodological choice: **both agents run the same model — Claude Haiku 4.5**, with reasoning mode disabled and prompt caching enabled identically. This isolates a single variable: domain architecture. If Adsum IoT Coder outperforms, it is not because it has access to a more capable model — it is because the architecture wraps the same model differently.

<div align="center">

<!-- TODO: Update chart with "Adsum IoT Coder" branding -->
<img src="docs/benchmarks/assets/figure1.png" width="65%" alt="BC Rate by Threshold" />

</div>

| Metric | Adsum IoT Coder | Claude Code |
|:---|:---|:---|
| BC@1 — resolved on first flash | **4 / 6** | 1 / 6 |
| BC@7 — within seven flashes | **5 / 6** | 3 / 6 |
| L1 (visible in logs) | **2 / 2** | 1 / 2 |
| L2 (inference required) | **2 / 2** | 2 / 2 |
| L3 (cross-device) | **1 / 2** | 0 / 2 |
| Total tokens consumed | **34.3M** | 78.5M |
| Tokens per resolved task | **1.86M** | 7.15M |

Three patterns in the data tell the more interesting story:

**Context degradation predicted failure.** Claude Code consumed 27M tokens on L1-T2 — a Level 1 task — and still failed. Peak context hit 169k of 200k, past the threshold where models begin losing early context. By the later debug cycles, the model had lost the original symptom description, leading to circular reasoning. Adsum IoT Coder resolved the same task at 148.7k peak. Same model. The difference is what the architecture chose to keep in context.

**Static Code Fix as a failure mode.** Claude Code skipped log capture on two tasks and diagnosed from source code alone (SCF). On L3-T1, the resulting fix was indeterminate — the root cause (bond asymmetry) is only visible through cross-device log correlation. The dynamic skill architecture eliminates this failure mode by design: log capture is a first-class step in the loaded workflow, not an optional step the agent might skip under exploration pressure.

**The gap widens with task difficulty.** On L2 tasks, both agents resolve everything — Claude Haiku 4.5 is genuinely capable. On L3 multi-device tasks, Adsum IoT Coder resolved 1/2 while Claude Code resolved 0/2 and fell back to source-only analysis. Domain-specific knowledge and tooling matter most where the problems are hardest.

<div align="center">

<!-- TODO: Update chart with "Adsum IoT Coder" branding -->
<img src="docs/benchmarks/assets/figure3.png" width="90%" alt="Token Consumption per Task" />

</div>

The architecture and the benchmark are two halves of the same commitment: domain-specific AI tooling clean enough to extend, and measurable enough to defend. Run the benchmark yourself. Compare against your own agent. That's the conversation we want to be in.

👉 [Full benchmark report](./docs/benchmarks/v0.1-report.md)

---

## Getting Started

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger), configure an AI provider, and open your NCS project. The agent starts with two entry-point workflows:

<!-- TODO: Replace with updated screenshot showing "Adsum IoT Coder" branding -->
<p><img src="assets/docs/home.png" width="100%" alt="Adsum IoT Coder Home" /></p>

**Analyze nRF Device Logs** — captures live RTT/UART logs from connected boards, runs code-aware analysis, produces structured reports. Auto-detects boards via J-Link, supports multi-device simultaneous capture, correlates output with your source code and configuration.

**Generate Logging Code** — reads your NCS project, understands the BLE stack, and injects `LOG_*` macros following Zephyr best practices. An agent that wrote the log statements analyzes the output more intelligently — it understands the context because it created it.

From analysis results, the agent can enter a **Debug Loop** — iterative Build → Flash → Capture → Analyze → Fix cycle — continuing until the bug is resolved or you stop it.

### Requirements

| Requirement | Details |
|:---|:---|
| **nRF Connect SDK** | v3.2.1 |
| **VS Code Extension** | [nRF Connect Extension Pack](https://marketplace.visualstudio.com/items?itemName=nordic-semiconductor.nrf-connect-extension-pack) |
| **Python** | 3.8+ (bundled with nRF Connect extension) |
| **AI Provider** | Any OpenAI-compatible endpoint |

### Tested Models

| Model | Notes |
|:---|:---|
| **Claude Haiku 4.5** | Used in the IoT-FirmwareDebugBench evaluation. |
| **DeepSeek-v4-Pro** | Cost-effective. Available via [OpenRouter](https://openrouter.ai/deepseek/deepseek-v4-pro) or [DeepSeek API](https://api-docs.deepseek.com/) using the OpenAI-compatible endpoint. |
| **GLM-4.7** | Cost-effective alternative; works well for long debug sessions. |

> Any OpenAI-compatible endpoint works, provided the model has strong **tool-calling** (function-calling) capabilities. Models without native tool-use support cannot execute hardware actions or debug workflows.

---

## Roadmap

The product line is **Adsum IoT Coder**, with each release scoped to a specific IoT chip family. "IoT" reflects the focus: communication stacks and protocol troubleshooting across the IoT chip landscape — BLE, WiFi, Thread, Matter, LTE-M — rather than silicon-level work. "Coder" reflects the trajectory: this release ships debugging because that's where general agents fail hardest, but the architecture is designed to cover the full IoT development lifecycle — design, implementation, verification, and field optimization.

| Category | Current | Next |
|:---|:---|:---|
| **Platforms** | Adsum IoT Coder – for nRF | Adsum IoT Coder – for ESP |
| **Boards** | nRF52840, nRF52832 | nRF54, nRF91, ESP32 boards |
| **Protocols** | BLE | WiFi, Thread, Matter, LTE-M, DECT NR+ |
| **NCS** | v3.2.x | v2.9.x LTS, v3.3+ |
| **Benchmark** | v0.1 (6 tasks, BLE, nRF) | v0.2 (20+ tasks, Copilot comparison, ESP suite) |
| **Tooling** | RTT/UART log capture, J-Link control | BLE sniffer integration, PPK II power profiling, spectrum analysis |

The roadmap is shaped by what the community asks for and contributes. [Open an issue, propose a benchmark task, or contribute a knowledge module.](https://github.com/adsumnetworks/SoC-AI-Debugger/issues)

---

## Limitations

We publish what's true today, not what we wish were true.

- **Benchmark scope.** Six tasks is sufficient for a proof-of-concept evaluation, not statistical significance. v0.2 targets 20–30 tasks.
- **SDK coverage.** All benchmark tasks ran on a single NCS version (v3.2.1). Older LTS versions are roadmap items.
- **Inter-rater reliability.** All benchmark sessions were run and scored by a single evaluator. Independent replication is actively welcomed.
- **Comparison breadth.** GitHub Copilot evaluation is planned for v0.2; token visibility on the free tier delayed it from v0.1.
- **Open unsolved task.** L3-T2 (HIDS security mismatch — central requests `BT_SECURITY_L3` MITM, peripheral offers `BT_SECURITY_L1`) remains unresolved by both agents. Diagnosing it requires SMP-layer event correlation invisible from UART alone. BLE sniffer integration (roadmap) is the planned approach.

The methodology is open precisely so others can probe these limits, run independent comparisons, and contribute tasks.

---

## Citing this work

If you reference the benchmark or this work in research, please cite:

```bibtex
@misc{adsumiotcoder2026,
  title  = {IoT-FirmwareDebugBench v0.1: A Hardware-in-the-Loop
            Evaluation Suite for AI Firmware Debugging Agents},
  author = {Adsum Networks},
  year   = {2026},
  url    = {https://github.com/adsumnetworks/SoC-AI-Debugger},
  note   = {Open source under Apache 2.0}
}
```

---

## About

**[Adsum Networks](https://github.com/adsumnetworks)** — 8+ years building IoT solutions on Nordic and other embedded platforms. We built Adsum IoT Coder because general-purpose coding agents leave embedded developers without reliable AI assistance precisely for the hardest debugging scenarios.

The first release (v1) was a focused proof of concept: nRF AI Debugger, scoped to log capture and analysis on Nordic boards. 200+ installs in two months told us the demand was real. The current release rebuilds the architecture to scale — and ships an open benchmark so the value can be measured, not just claimed. This is the kind of accountability we want every future release to be subject to.

The product is **Adsum IoT Coder** rather than "Debugger" because the roadmap covers the full IoT development lifecycle. Debugging is what we shipped first because that's where general agents fail hardest and the value is most measurable. Architecture proposals, low-power optimization, protocol-correctness review, and code-weakness analysis are all natural extensions of the same dynamic-knowledge framework.

---

## Privacy & Security

The agent runs entirely on your machine. Only specific log snippets and code context are sent to your chosen AI provider. BYOK (Bring Your Own Key) — you control which model and endpoint you trust. Source is fully open and auditable.

**Telemetry.** Basic, anonymous usage data: extension activations, tool triggers, execution errors. Never collects source code, file paths, chat content, or device logs. Opt out: set `telemetry.telemetryLevel` to `off` in VS Code settings.

---

## Troubleshooting

**Shell integration warning** on first run — restart VS Code and open a new terminal session.

**Linux notifications** — if `ENOENT` errors appear when tasks complete: `sudo apt install libnotify-bin`

---

### Trademark & Disclaimer

Independent, community-developed tool. Not affiliated with, endorsed by, or sponsored by Nordic Semiconductor ASA. "nRF" is a registered trademark of Nordic Semiconductor ASA.

## Acknowledgments

- [Cline](https://github.com/cline/cline) — The open-source AI coding agent this project builds upon.
- [Nordic Semiconductor](https://www.nordicsemi.com/) — For the nRF Connect SDK and developer tools.
- The authors of [arXiv:2603.19583](https://arxiv.org/abs/2603.19583) — For foundational research on hardware-in-the-loop evaluation for embedded systems, which inspired our benchmarking methodology.

## License

[Apache 2.0 © 2026 Adsum Networks](./LICENSE)
