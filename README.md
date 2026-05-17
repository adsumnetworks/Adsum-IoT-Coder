<div align="center">

<img src="assets/icons/icon.png" width="120" alt="Adsum IoT Coder" />

# Adsum IoT Coder – for nRF

Open-source AI coding agent for IoT firmware development — starting with Nordic nRF.

Built on a dynamic knowledge architecture that loads nRF Connect SDK/ZephyrRTOS domain expertise on demand, scoped to the task. Evaluated on real hardware with an open benchmark. Open source under Apache 2.0.

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger"><img src="https://img.shields.io/visual-studio-marketplace/v/AdsumNetwork.nrf-ai-debugger?label=VS%20Code%20Marketplace&logo=visual-studio-code&color=0078d4" alt="VS Marketplace"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/nRF%20Connect%20SDK-v3.2.1-00A9CE" alt="NCS">
  <img src="https://img.shields.io/badge/Zephyr%20RTOS-compatible-blueviolet" alt="Zephyr">
</p>

<!-- TODO: Replace with updated demo GIF showing "Adsum IoT Coder" branding -->
<p><img src="assets/docs/demo.gif" width="100%" alt="Adsum IoT Coder Demo" /></p>

</div>

---

## The Problem with General-Purpose Coding Agents in IoT

Coding agents like Claude Code, GitHub Copilot, and Cursor were designed for software development. They perform well on web applications and backend services. They do not perform well on embedded firmware — and the reasons are structural, not about model capability.

Firmware debugging requires hardware-in-the-loop log capture, domain-specific knowledge of BLE protocol stacks and NCS/ZephyrRTOS internals, toolchain environment management, and runtime-only failure modes that are invisible from source code alone. A `settings_load()` call missing after `bt_enable()` compiles fine, connects fine, and silently breaks GATT notifications after reconnect. An advertising filter with an empty accept list makes the device scannable but impossible to connect to — with zero errors in the log. A connection parameter mismatch between a Central and Peripheral only surfaces when you correlate timestamps across two separate log streams.

General-purpose agents have no answer for these problems. They struggle to capture device logs. They don't understand NCS Kconfig dependency chains. They hallucinate APIs from old NCS versions. And when they can't diagnose from source alone, they spend cycles exploring wrong hypotheses until the context window fills and reasoning degrades.

Adsum IoT Coder is a different kind of coding agent — one built specifically for IoT firmware, with the domain architecture to match.

---

## Architecture — Dynamic Knowledge & Tool-Skill Loading

The first version of this tool carried its full domain expertise into every session. NCS documentation, board-specific patterns, Kconfig knowledge, BLE lifecycle reasoning, tool-use protocols — all loaded upfront regardless of whether the task needed any particular piece. That approach worked but couldn't grow. Adding nRF53 support meant expanding the static bundle. Adding ESP, Thread, or Matter meant the same.

The current architecture inverts this. Domain knowledge and tool-use skills are structured as a framework of discrete, composable modules — each scoped to a specific chip family, protocol stack, or debug capability. At session start, the agent assesses what the project actually is and what the task actually requires, then fetches the relevant modules on demand.

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
│   │   └──SDK.md                 # NCS-specific modules
│   ├── workflows/                # Entry-point sequences (start here)
│   │   ├── log-analyzer.md       # Capture → Analyze → Report
│   │   ├── log-generator.md      # Instrument firmware with LOG_* macros
│   │   └── debug-loop.md         # Build → Flash → Capture → Analyze → Fix
│   └── actions/                  # Subroutines (loaded by workflows only)
│       ├── capture-logs.md       # Capture logs from device
│       ├── analyze-logs.md       # Analyze logs for errors
│       ├── build.md              # Build firmware
│       └── flash.md              # Flash firmware to device
```

Analyzing a UART log drop loads `log-analyzer.md` + `capture-logs.md` + `sdks/ncs/SDK.md`. Debugging a failed BLE connection on a two-board setup also pulls in `BLE.md`, `device-identity.md`, and the relevant board file — and nothing else. The model gets exactly what the task requires, no more.

This is what makes the architecture scalable in a way v1 wasn't:

- **New chip families add as modules**, not as core changes. nRF52 ships today. nRF53, nRF91, nRF54 are designed to slot in. **Adsum IoT Coder – for ESP** is next on the roadmap.
- **New protocol stacks add as modules.** BLE today; WiFi, Thread, Matter, LTE-M, DECT NR+ are roadmap items the architecture is designed to absorb.
- **New tool-use skills add as modules.** Need a different log capture backend, a different build system, a different flashing tool? Author the skill module; the agent loads it when the task calls for it.
- **Context proportional to task complexity.** No fixed-cost domain bundle eating context budget regardless of difficulty. On complex multi-cycle debug sessions, this is the difference between finishing the work and hitting context overflow.

---

## Benchmark — IoT-FirmwareDebugBench v0.1

A clean architecture is only useful if it produces measurably better outcomes. While there are standard SWE benchmarks, evaluating AI agents on *real hardware* is still an emerging field. We built our evaluation infrastructure inspired by recent research ([arXiv:2603.19583](https://arxiv.org/abs/2603.19583)), which pioneered hardware-in-the-loop evaluation for embedded code generation and concluded that expert-authored skills significantly improve LLM performance on firmware tasks. 

While their foundational work focused on general embedded code generation, we adapted their methodology specifically for **IoT firmware debugging**. We built **IoT-FirmwareDebugBench v0.1** and are publishing it open source as a deliverable equal in importance to the tool itself.

**[IoT-FirmwareDebugBench v0.1](./docs/benchmarks/v0.1-report.md)** is a hardware-in-the-loop evaluation suite running on real nRF52840 DK and nRF52832 DK boards with NCS v3.2.1 (Zephyr 4.2.99). Six tasks across three difficulty levels, each with a precisely injected bug, defined reproduction procedure, and known correct fix.

**The most important methodological choice:** both agents run **the same model — Claude Haiku 4.5**, with reasoning mode disabled and prompt caching enabled identically. This isolates a single variable: domain architecture. If Adsum IoT Coder outperforms, it is not because it has access to a more capable model. It is because the architecture wraps the same model differently.

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

**Limitations we're upfront about.** Six tasks is sufficient for proof-of-concept, not statistical significance — targeting 20-30 for v2. Single NCS version (v3.2.1). Single evaluator. GitHub Copilot evaluation planned for v2. The methodology is published openly so others can probe these limits, run independent comparisons, and contribute tasks.

👉 [Full benchmark report](./docs/benchmarks/v0.1-report.md) 

---

## Getting Started

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AdsumNetwork.nrf-ai-debugger), configure an AI provider, and open your NCS project. The agent starts with two entry-point workflows:

<!-- TODO: Replace with updated screenshot showing "Adsum IoT Coder" branding -->
<p><img src="assets/docs/home.png" width="100%" alt="Adsum IoT Coder Home" /></p>

**Analyze nRF Device Logs** — captures live RTT/UART logs from connected boards, runs code-aware analysis, produces structured reports. Auto-detects boards via J-Link, supports multi-device simultaneous capture, correlates output with your source code and configuration.

**Generate Logging Code** — reads your NCS project, understands the BLE stack, and injects `LOG_*` macros following Zephyr best practices. An agent that wrote the log statements analyzes the output more intelligently — it understands the context because it created it.

From analysis results, the agent can enter a **Debug Loop** — iterative Build → Flash → Capture → Analyze → Fix cycle — continuing until the bug is resolved or the user decides to stop.

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
| **DeepSeek-v4-Pro** | Recommended for cost-effective sessions. Available via [OpenRouter](https://openrouter.ai/deepseek/deepseek-v4-pro) or [DeepSeek API](https://api-docs.deepseek.com/) using the OpenAI-compatible endpoint. |
| **Claude Haiku 4.5** | Used in the IoT-FirmwareDebugBench evaluation. |

> **Note on Model Support:** You can test any model via OpenRouter or an OpenAI-compatible endpoint, provided the model has strong **Tool Calling** (function calling) capabilities. Legacy models or models without native tool support will not be able to execute the hardware actions or debugging workflows.

---

## Roadmap

The product line going forward is **Adsum IoT Coder**, with each release scoped to a specific IoT chip family. The "IoT" in the name reflects the real focus: communication stacks and protocol troubleshooting across the IoT chip landscape — BLE, WiFi, Thread, Matter, LTE-M — rather than silicon-level work.

| Category | Current | Next |
|:---|:---|:---|
| **Platforms** | Adsum IoT Coder – for nRF | Adsum IoT Coder – for ESP |
| **Boards** | nRF52840, nRF52832 | nRF54, nRF91, ESP32 boards |
| **Protocols** | BLE | WiFi, Thread, Matter, LTE-M, DECT NR+ |
| **NCS** | v3.2.x | v2.9.x LTS, v3.3+ |
| **Benchmark** | v0.1 (6 tasks, BLE, nRF) | v0.2 (20+ tasks, Copilot comparison, ESP suite) |

Expanding based on community needs. [Join our discussions.](https://github.com/adsumnetworks/SoC-AI-Debugger/discussions)

---

## Privacy & Security

The agent runs entirely on your machine. Only specific log snippets and code context are sent to your chosen AI provider. BYOK (Bring Your Own Key) — you control which model and endpoint you trust. Source is fully open and auditable.

**Telemetry.** Basic, anonymous usage data: extension activations, tool triggers, execution errors. Never collects source code, file paths, chat content, or device logs. Opt out: set `telemetry.telemetryLevel` to `off` in VS Code settings.

---

## Troubleshooting

**Shell integration warning** on first run — restart VS Code and open a new terminal session.

**Linux notifications** — if `ENOENT` errors appear when tasks complete: `sudo apt install libnotify-bin`

---

## About

**[Adsum Networks](https://github.com/adsumnetworks)** — 8+ years building IoT solutions on Nordic and other embedded platforms. We built Adsum IoT Coder because general-purpose coding agents leave embedded developers without reliable AI assistance precisely for the hardest debugging scenarios. The architecture and the benchmark are two halves of the same commitment: build domain-specific AI tooling that's clean enough to extend and measurable enough to defend.

---

### Trademark & Disclaimer
Independent, community-developed tool. Not affiliated with, endorsed by, or sponsored by Nordic Semiconductor ASA. "nRF" is a registered trademark of Nordic Semiconductor ASA.

## Acknowledgments

- [Cline](https://github.com/cline/cline) — The open-source AI coding agent this project builds upon.
- [Nordic Semiconductor](https://www.nordicsemi.com/) — For the nRF Connect SDK and developer tools.
- The authors of [arXiv:2603.19583](https://arxiv.org/abs/2603.19583) — For their foundational research on hardware-in-the-loop evaluation for embedded systems, which heavily inspired our benchmarking methodology.

## License
[Apache 2.0 © 2026 Adsum Networks](./LICENSE)