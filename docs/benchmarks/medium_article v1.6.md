# Medium Article — Adsum IoT AI Debugger – for nRF Launch

**Suggested publication:** Towards Data Science, Better Programming, or self-published

---

# Adsum IoT AI Debugger – for nRF: A Clean Architecture and an Open Benchmark for Embedded AI Tooling

## Why we rebuilt our nRF firmware debugging agent around dynamic IoT knowledge & tool-skill loading — and built the benchmarking framework to prove it works

---

Two months ago we launched nRF AI Debugger: a VS Code extension that captures live RTT/UART logs from Nordic nRF boards and runs an AI debug agent over them. We built it to validate a thesis — that purpose-built AI tooling for embedded firmware could meaningfully outperform general coding agents on hardware-in-the-loop debugging.

The thesis held up. Over 200 installs in two months told us the value was real. But the architecture underneath the proof of concept was never designed to scale, and we had no rigorous way to measure how the tool stacked up against leading agentic coding tools beyond user reports.

This release fixes both gaps. We're shipping two things together:

1. A clean, scalable agent architecture, organized around **dynamic IoT knowledge and tool-skill loading**.
2. **IoT-FirmwareDebugBench v1** — an open hardware-in-the-loop benchmark for measuring agentic IoT debugging tools against each other.

We're also renaming. The product line going forward is **Adsum IoT AI Debugger**, with each release scoped to a specific IoT chip family. This release is **Adsum IoT AI Debugger – for nRF**. **Adsum IoT AI Debugger – for ESP** is next. The "IoT" in the name reflects the real focus: communication stacks and protocol troubleshooting across the IoT chip landscape — BLE, WiFi, Thread, Matter, LTE-M — rather than silicon-level work.

This post is about both deliverables, and why they belong together.

---

## Part 1: The Architecture — Dynamic Knowledge & Tool-Skill Loading

The thing we got most wrong in v1 wasn't any specific feature. It was the assumption that the agent should carry its full domain expertise into every session. NCS / ZephyrRTOS documentation, board-specific patterns, Kconfig dependency knowledge, BLE lifecycle reasoning, tool-use protocols — all of it loaded upfront, regardless of whether the task at hand needed any particular piece.

That assumption produced a tool that worked but couldn't grow. Adding nRF53 support meant expanding the static knowledge bundle. Adding ESP, Thread, or Matter meant the same. The bundle grew, the context window filled faster, and the architecture sat on a cliff edge.

The new architecture inverts this. Domain knowledge and tool-use skills are now structured as a framework of discrete, composable modules — each scoped to a specific chip family, protocol stack, or debug capability. At session start, the agent assesses what the project actually is and what the task actually requires, then fetches the relevant modules on demand.

A simple L1 log buffer task on an nRF52840 BLE peripheral pulls a small, focused profile: NCS / ZephyrRTOS logging configuration, basic Bluetooth subsystem patterns, build-and-flash tool skills. An L3 cross-device debug session on a HIDS central-peripheral pair pulls a richer profile: BLE security mode reasoning, HIDS service behavior, multi-device log correlation skills, bond-state management knowledge. Different tasks load different knowledge, scoped to what the work actually needs.

This is what makes the architecture clean and scalable in a way v1 wasn't:

- **New chip families add as modules**, not as core changes. nRF52 ships today as **IoT AI Debugger – for nRF**. **IoT AI Debugger – for ESP** is next. nRF53, nRF91, and nRF54 are designed to slot in as modules under the for-nRF release. The product-line naming reflects the framework's structure.
- **New protocol stacks add as modules**. BLE today; WiFi, Thread, Matter, LTE-M, and DECT NR+ are roadmap items the architecture is designed to absorb.
- **New tool-use skills add as modules**. Need a different log capture backend, a different build system, a different flashing tool? Author the skill module; the agent loads it when the task calls for it.

The whole framework is essentially a set of skills that come down on demand, scoped to the project. That's the headline.

### What this unlocks in practice

Three things v1 couldn't do well, the new architecture handles by design.

**Context proportional to task complexity.** The agent only carries what the current task requires. There's no fixed-cost domain bundle eating context budget regardless of difficulty. On simple tasks, this is invisible. On complex multi-cycle debug sessions, it's the difference between finishing the work and not.

**Expert behavior without exploration overhead.** When the loaded knowledge profile includes structured patterns for canonical NCS / ZephyrRTOS failure modes — `settings_load()` ordering after `bt_enable()`, `BT_LE_ADV_OPT_FILTER_CONN` empty-allowlist behavior on first boot, BLE connection lifecycle traps — the agent reaches diagnoses an experienced NCS / ZephyrRTOS developer would reach immediately, rather than deriving them from first principles each session.

**Real extensibility.** Adding new chip support, new protocols, or new tool integrations is now a module-authoring task, not a core architecture change. This is what "scalable" actually means — the architecture grows with what users need, without growing the core.

---

## Part 2: The Benchmark — IoT-FirmwareDebugBench v1

A clean architecture is only useful if it produces measurably better outcomes. And in the agentic coding tooling landscape, "measurably better" is exactly what nobody has good infrastructure for. There are coding benchmarks. There are SWE benchmarks. There is no standard, credible, hardware-in-the-loop way to evaluate AI debugging agents on real embedded firmware.

So we built one — and we're publishing it open source as a deliverable equal in importance to the tool itself.

IoT-FirmwareDebugBench v1 is a hardware-in-the-loop evaluation suite running on real nRF52840 DK and nRF52832 DK boards with NCS v3.2.1 (Zephyr 4.2.99). An ESP task suite is next on the roadmap. Six tasks across three difficulty levels, each with a precisely injected bug, defined reproduction procedure, and known correct fix.

### Task levels

**L1 — Visible in logs.** Root cause readable directly from UART/RTT output. Example: `CONFIG_LOG_BUFFER_SIZE` set to 256 while verbose Bluetooth logging is enabled. The agent needs to see the dropped messages, identify the buffer constraint, and apply the correct fix.

**L2 — Requires inference.** Root cause not explicit in logs — inferred from BLE behavior or Kconfig dependency chains. Example: `settings_load()` removed from `main.c`. The device pairs successfully. After reconnect, notifications stop working with `-5 ENOENT`. Logs show the reconnection succeeding. The bug is invisible unless you know that bonds and CCCD state are only restored if `settings_load()` is called after `bt_enable()`. A general agent without NCS / ZephyrRTOS knowledge will spend cycles exploring the wrong hypotheses.

**L3 — Cross-device, timing, state.** Cause and symptom distributed across two boards or dependent on connection lifecycle correlation. Example: a Central NUS subscription path altered in `discovery_complete()`, combined with bond/state asymmetry between the two devices. The BLE link comes up. Initial UART exchange succeeds. Reflash the central, reconnect — data flows in one direction only. Diagnosing requires correlating log timestamps across both devices and tracing the asymmetry back to the subscription logic.

### Evaluation methodology

Each task runs through an eight-step debug life-cycle: capture logs → analyze → identify root cause → apply fix → build and flash → capture fresh logs → verify → summarize. The primary metric is BC@k (Behavior Correct within k debug cycles, where k counts only successful flashes). We also track total token consumption and peak context utilization (model maximum 200k tokens).

Outcome codes capture failure modes precisely: BC (Behavior Correct), FI (Fix Incomplete — flashed but bug persists), LCF (Log Capture Failure), SCF (Static Code Fix — agent skipped log capture and diagnosed from source alone), CF (Compile Failure), AF (Analysis Failure). SCF is recorded as a methodology failure regardless of outcome, because runtime-only and multi-device bugs are not diagnosable from source code alone.

The harness, task suite, scoring scripts, and the Python token accounting tooling for parsing Claude Code JSONL session logs are all in the repository. Independent replication is actively welcome.

### Same model, different architecture

The most important methodological choice in this evaluation: **both agents run the same underlying model — Claude Haiku 4.5**, with reasoning mode disabled and prompt caching enabled identically for both. The IoT AI Debugger uses it through its custom VS Code extension with the dynamic skill framework. Claude Code uses it through the official VS Code extension with workspace files only.

This isolates a single variable: domain architecture. If the IoT AI Debugger outperforms, it is not because it has access to a more capable model. It is because the architecture wraps the same model differently.

### Example comparison: IoT AI Debugger – for nRF vs Claude Code

| Metric | IoT AI Debugger – for nRF | Claude Code |
|---|---|---|
| BC@1 — resolved on first flash | **4 / 6** | 1 / 6 |
| BC@3 | **4 / 6** | 2 / 6 |
| BC@5 | **4 / 6** | 3 / 6 |
| BC@7 — within seven flashes | **5 / 6** | 3 / 6 |
| L1 (visible in logs) | **2 / 2** | 1 / 2 |
| L2 (inference required) | **2 / 2** | 2 / 2 |
| L3 (cross-device) | **1 / 2** | 0 / 2 |
| Total tokens | **34.3M** | 78.5M |
| Tokens per resolved task | **1.86M** | 7.15M |
| Peak context (worst case) | 148.7k | 169k (degraded) |

The headline numbers: the IoT AI Debugger resolved 5 of 6 tasks at BC@7, versus 3 of 6 for Claude Code, with a 3.8× token efficiency advantage on resolved tasks. But three details in the data tell the more interesting story.

**Context degradation predicted failure.** Claude Code consumed 27 million tokens on L1-T2 — a Level 1 task — and still failed to resolve it. Peak context hit 169k of 200k, past the 80% threshold where models begin losing track of early context. By the time the agent was on its later debug cycles, it had lost the original symptom description and earliest log analysis, leading to circular reasoning. The IoT AI Debugger handled the same task at 148.7k peak and resolved it. Same model. The difference is what the architecture chose to keep in context.

**Static Code Fix as a failure mode.** Claude Code exhibited SCF behavior on L2-T1 (first attempt) and L3-T1 (all attempts) — diagnosing from source code without capturing device logs. On L2-T1, static analysis accidentally produced a correct fix on the second attempt. On L3-T1, the resulting fix was behaviorally indeterminate, because the root cause (bond asymmetry revealed only through cross-device log correlation) is invisible from source code. SCF is methodologically a failure regardless of outcome — and it's a failure mode the dynamic skill architecture eliminates by design, because log capture is a first-class step in the loaded debug workflow rather than an optional step the agent might skip under exploration pressure.

**The gap widens with task difficulty.** On L1 tasks, the gap is 2/2 vs 1/2. On L2, both agents resolve everything (Claude Haiku 4.5 is genuinely capable). On L3 multi-device tasks, the IoT AI Debugger resolved 1/2 while Claude Code resolved 0/2 and fell back to SCF on the one task it would otherwise have had a chance at. This is exactly the shape we'd expect: domain-specific knowledge and tooling matter most where the problems are hardest.

### The open challenge

L3-T2 remains unsolved by both agents — a HIDS security mismatch where the central requests `BT_SECURITY_L3` (MITM protection) and the peripheral offers `BT_SECURITY_L1`. Pairing fails with error 2. The HID service never reaches a ready state. Diagnosing requires correlating SMP-layer security negotiation events across two devices, and the failure is invisible from UART logs alone. We have BLE sniffer integration in development to address this class of task by providing PHY-layer visibility — and the same task will appear in v2 of the benchmark to measure whether that integration solves it.

### Limitations we're upfront about

Six tasks is sufficient for a proof-of-concept evaluation, not for statistical significance — we're targeting 20-30 tasks for v2. All tasks validated on a single NCS version (v3.2.1). All sessions were run and scored by a single evaluator, so inter-rater reliability has not been established. GitHub Copilot evaluation is planned for v2; token visibility on the free tier delayed it from this release.

We're publishing the methodology openly precisely so others can probe these limits, run independent comparisons, and contribute task additions.

---

## Why Both Pieces Belong Together

Shipping the architecture without the benchmark would have been business as usual — a vendor announcing a tool with claimed improvements. Shipping the benchmark without the architecture would have been a research artifact without a working example.

Together, they make a different kind of argument: **here is a tool, here is the open framework for measuring it, and here are the results.** Run the benchmark yourself. Run it against your own AI debugging tool, or your favorite agentic coding agent. Compare. Argue. The point of publishing the benchmark is that this should be a measurable, ongoing conversation — not a marketing claim that depends on us being the only people who can verify it.

The same-model methodology matters here. Anyone evaluating embedded AI tooling can run a domain-specific agent and a general agent on the same model and compare results. If our claims hold, others should reproduce them. If they don't, that is also useful information. Either way, the conversation is grounded.

This is the kind of accountability we want every release of IoT AI Debugger to be subject to. As **IoT AI Debugger – for ESP** comes online, it will ship alongside an ESP task suite, run against the same agentic coding tools. As we extend to WiFi, Thread, and Matter modules, each will come with task suites that exercise them.

The architecture and the benchmark are two halves of the same commitment: build domain-specific AI tooling that's clean enough to extend and measurable enough to defend.

---

## Getting Started

IoT AI Debugger – for nRF is open source under Apache 2.0, free to use.

**Install:** Search "IoT AI Debugger" in the VS Code Marketplace, or visit the GitHub repository.

**Configure:** Connect to any OpenAI-compatible endpoint. The benchmark in this report ran on Claude Haiku 4.5 via OpenRouter for both agents, to isolate architectural contribution. For cost-sensitive sessions, GLM-4.7 also works well.

**Requirements:** nRF Connect Extension Pack in VS Code, Python 3.8+ (bundled with the nRF Connect extension), J-Link connected nRF52840 DK or nRF52832 DK.

**GitHub:** https://github.com/adsumnetworks/SoC-AI-Debugger

The benchmark harness lives in `evals/`. Token accounting tooling for Claude Code JSONL sessions is included.

---

To the 200+ developers who used nRF AI Debugger and validated that purpose-built embedded AI tooling has real value — thank you. The next architecture is built to grow with what you ask of it, and the next benchmark is built to keep us honest about whether it does.

---

*Built by Adsum Networks. Not affiliated with Nordic Semiconductor ASA.*
