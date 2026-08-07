---
id: adsum/rules/skill-loading
title: "Universal Rule: Skill Loading"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: universal
---

# Universal Rule: Skill Loading (rules/skill-loading.md)

This is the platform-neutral doctrine shared by every platform's `rules/skill-loading.md` stub
(`platforms/nrf/rules/skill-loading.md`, `platforms/esp/rules/skill-loading.md`). It defines the loading
*mechanics*. Each platform stub adds the concrete Operation → Workflow table, Command Gate table, and
worked examples for that platform's own commands (`west` vs `idf.py`) — read the stub too; it is not
optional.

---

## The Operation-Gating Principle (read this first)

**Before you perform any complex embedded operation, you MUST first `read_file` the Workflow that covers it.**

This rule fires whenever you are *about to act*, regardless of how you arrived at that moment:

- The user explicitly asked for the operation.
- You decided to perform it based on your own analysis or reasoning.
- Another Workflow handed off to this operation.
- The conversation moved on after a previous Workflow completed, and the user's next request involves the operation again.

You may NOT execute a complex operation from pre-trained knowledge or general assumptions — the Workflow
is the source of truth for the steps, permission gates, error handling, and Action chain. "Loading" the
Workflow is the same act as `read_file` on the markdown file; there is no separate `load_workflow` tool.

If an upcoming operation matches no row of the platform stub's Operation → Workflow table, you are not in
a Workflow's scope — proceed with standard tool use (consult `AGENT.md` Scope Gate first).

---

## Workflows vs Actions (Hierarchy)

- **Workflows** (`platforms/<platform>/workflows/*.md`) are the **only** valid entry points. They
  orchestrate multi-step protocols and are loaded by *you* via the Operation-Gating Principle above.
- **Actions** (`platforms/<platform>/actions/*.md`) are atomic subroutines invoked *by an active Workflow*
  through a `MANDATORY SKILL LOAD` directive. You are **STRICTLY FORBIDDEN** from loading an Action as the
  first read of a task. Read an Action only when the Workflow you are currently executing explicitly
  instructs you to — **or when the Command Gate below fires**.

---

## The Command Gate (HARD RULE — fires at the moment of execution)

The Operation-Gating Principle fires on *intent*. The Command Gate fires on the *act*: the instant you are
about to issue one of the commands in the platform stub's Command Gate table, the matching Action file
MUST already be in your context. If it is not, **STOP and `read_file` it first** — no exceptions,
regardless of which Workflow you are in, how you entered it, or how confident you feel.

**Why this is non-negotiable:** these files contain hardware-verified rules you cannot derive from general
knowledge. Running these operations by trial-and-error is the **#1 documented field failure** of this
agent. One `read_file` is always cheaper than a failed flash or a misleading capture. See the platform
stub's Command Gate table for the exact commands, files, and platform-specific technical reasons.

**Capture without analysis is an unfinished operation.** After any log capture, the analyze step (per the
platform's `analyze-logs.md`) is part of the same operation — never end at "logs captured".

---

## Load-Once Optimization

If a Workflow or Action file is already present in your current conversation context (you read it earlier
this task), do **not** read it again — its contents are still authoritative. Re-read a file only when:

- It is no longer in your immediate context (truncated, compacted, or a new session).
- You need to correct a mistake and want to re-verify the exact instructions.

This applies equally to Workflow files, Action files, and this shared rules file itself — once loaded this
task, rely on what's already in context. Files listed under "Knowledge Already Loaded" in your system
context are already present — never re-read those.

---

## Worked Examples (illustrations of the principle, not an exhaustive list)

1. **User opens a fresh chat and asks for a build/flash/debug operation** — you are about to act → read the matching Workflow.
2. **Mid-conversation you discover a prerequisite step was skipped** (e.g. the firmware was never flashed) — you are about to perform that operation → read its Workflow, even if a different Workflow is already active.
3. **A Workflow tells you to load an Action via a `MANDATORY SKILL LOAD` directive** — obey the directive.
4. **The user asks a question that matches no operation in the platform's table** (e.g. "explain what this config option does") — no Workflow load needed → answer from your knowledge with the `AGENT.md` Scope Gate applied.
5. **You're deep in a scaffold Workflow and the code is ready to build** — the Command Gate fires in sequence: build → flash → capture → analyze. Skipping any of these because "the Workflow is already loaded" is the failure this gate exists to prevent.

See the platform stub (`platforms/<platform>/rules/skill-loading.md`) for the concrete Operation →
Workflow table, Command Gate table, and platform-specific worked examples.
