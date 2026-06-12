---
id: adsum/nrf/rules/skill-loading
title: "nRF Platform Rule: Skill Loading"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
---

# nRF Platform Rule: Skill Loading (rules/skill-loading.md)

This rule governs when and how the agent loads Workflows and Actions from the `iot-knowledge` library.

---

## The Operation-Gating Principle (read this first)

**Before you perform any complex nRF operation, you MUST first `read_file` the Workflow that covers it.**

This rule fires whenever you are *about to act*, regardless of how you arrived at that moment:

- The user explicitly asked for the operation.
- You decided to perform it based on your own analysis or reasoning.
- Another Workflow handed off to this operation.
- The conversation moved on after a previous Workflow completed, and the user's next request involves the operation again.

You may NOT execute a complex operation from pre-trained knowledge or general assumptions — the Workflow is the source of truth for the steps, permission gates, error handling, and Action chain. "Loading" the Workflow is the same act as `read_file` on the markdown file; there is no separate `load_workflow` tool.

---

## Operation → Workflow

This table is organized by what you, the agent, are about to *do* — not by what the user typed. Use it the moment you recognize the upcoming operation.

| About to do (the operation) | Workflow to load first |
|---|---|
| **One-click demo** — task starts with `Demo:` or contains `[ADSUM_DEMO:` | Load `platforms/nrf/workflows/demo-debug.md` and follow it. The task message provides real file paths — use `read_file` on each. Do not connect to devices. |
| **Scaffold a new nRF prototype** — task contains `scaffold a new nRF prototype` or `Start a new nRF/Zephyr prototype` | `platforms/nrf/workflows/prototype.md` |
| **Add a feature to an existing project** — task contains `add a feature` or `Add a feature to` | `platforms/nrf/workflows/add-feature.md` |
| **Test or validate firmware** — task contains `test and validate` or `Prove` + `works` | `platforms/nrf/workflows/test-validate.md` |
| Build firmware · Flash firmware · run the Build → Flash → Capture → Analyze → Fix iteration cycle | `platforms/nrf/workflows/debug-loop.md` |
| Capture device logs (UART/RTT) · perform log analysis · diagnose runtime behaviour from logs | `platforms/nrf/workflows/log-analyzer.md` |
| Inject `LOG_*` macros into source · configure the log backend in `prj.conf` · enable deep BLE stack logging · prepare a project for future log capture | `platforms/nrf/workflows/log-generator.md` |

If an upcoming operation does not match any row, you are not in a Workflow's scope and may proceed with standard tool use (consult `AGENT.md` Scope Gate first).

---

## Workflows vs Actions (Hierarchy)

- **Workflows** are the **only** valid entry points. They orchestrate multi-step protocols and are loaded by *you* via this rule.
- **Actions** (`platforms/nrf/actions/*.md`) are atomic subroutines invoked *by an active Workflow* through a `MANDATORY SKILL LOAD` directive. You are **STRICTLY FORBIDDEN** from loading an Action as the first read of a task. Read an Action only when the Workflow you are currently executing explicitly instructs you to.

---

## Load-Once Optimization

If a Workflow file is already present in your current conversation context (you read it earlier this task), do **not** read it again — its contents are still authoritative. Re-read a Workflow file only when:

- It is no longer in your immediate context (truncated, compacted, or a new session).
- You need to correct a mistake and want to re-verify the exact instructions.

The same load-once rule applies to Action files: once an Action has been loaded during the current Workflow execution, do not re-load it on subsequent iterations of the same Workflow.

---

## Worked Examples (illustrations of the principle, not an exhaustive list)

1. **User opens a fresh chat and says "flash my code to the nRF52832"** — you are about to flash → read `workflows/debug-loop.md`.
2. **You finished `log-analyzer` and the user says "ok now generate more logs"** — you are about to generate logs → read `workflows/log-generator.md`.
3. **Mid-conversation in `log-analyzer`, you discover the firmware was never flashed and the capture returned nothing useful** — you are about to flash → read `workflows/debug-loop.md`.
4. **You're inside `debug-loop` and it tells you to load `actions/build.md` via a `MANDATORY SKILL LOAD` directive** — the Workflow is invoking an Action; obey the directive.
5. **User asks an embedded question that doesn't match any operation in the table** (e.g., "explain what `CONFIG_BT_MAX_CONN` does") — no Workflow load needed; answer from your knowledge with the `AGENT.md` Scope Gate applied.
