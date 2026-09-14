---
id: adsum/rules/bit-loading
title: "Universal Rule: Bit Loading"
type: knowledge
version: 1.4.1
supersedes: adsum/rules/skill-loading
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: universal
---

# Universal Rule: Bit Loading (rules/bit-loading.md)

This is the platform-neutral doctrine shared by every platform's `rules/bit-loading.md` stub
(`platforms/nrf/rules/bit-loading.md`, `platforms/esp/rules/bit-loading.md`). It defines the loading
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
Workflow is the same act as `read_file` on the markdown file.

There is no tool for this and no MCP server behind it. "Loading" a bit IS `read_file` on the
markdown file — nothing else. Do not call `load_bit`, `load_workflow` or any similar verb, and do
not address one to an MCP server. (`load_bit` exists only when Adsum runs as an MCP server for a
developer's own agent; inside this extension it does not.) The paths you see under
`iot-knowledge/` the paths you see under `iot-knowledge/` are FILES ON DISK in
the extension's install directory, not a server namespace, and a request to a server called
`iot-knowledge` reaches nothing. On 2026-08-29 a live run stalled doing exactly that — it asked an
`iot-knowledge` MCP server for `load_bit("adsum/nrf/sdks/ncs/sample-http-client")` when no MCP server
was configured at all. The directive that prompts this reads **MANDATORY BIT LOAD**, which is why the
invented verb is usually `load_bit`; the word "LOAD" there is an instruction to read a file.

If an upcoming operation matches no row of the platform stub's Operation → Workflow table, you are not in
a Workflow's scope — proceed with standard tool use (consult `AGENT.md` Scope Gate first).

---

## Workflows vs Actions (Hierarchy)

- **Workflows** (`platforms/<platform>/workflows/*.md`) are the **only** valid entry points. They
  orchestrate multi-step protocols and are loaded by *you* via the Operation-Gating Principle above.
- **Actions** (`platforms/<platform>/actions/*.md`) are atomic subroutines invoked *by an active Workflow*
  through a `MANDATORY BIT LOAD` directive. You are **STRICTLY FORBIDDEN** from loading an Action as the
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

## Naming a bit is not loading it — the load happens BEFORE the next tool call

**HARD RULE.** The moment you write that a bit is relevant — *"let me load X"*, *"X covers this"*,
*"I should read X first"* — the very next thing you do is `read_file` it. Not after one more look
at the tree, not after checking the structure, not after a quick grep to orient yourself. There is
no step that legitimately comes between naming a bit and loading it.

**Why this exists, and it is not a style preference.** Asked to check a
dashboard renders before a flash, an agent reasoned: *"This is a LEW840X gateway project… Let me
load the gateway-dashboard-ui knowledge bit since I'm about to check the dashboard page
rendering. **Actually let me first understand the structure.**"* It never came back. It then ran
the project's own checked-in check and reported success, having never seen the render rules the
bit exists to supply. Every part of the routing worked — the product was identified, the right
bit was named — and the load was deferred behind one more orienting step and lost.

That is the whole failure. Not a bit that could not be found; a bit that was found, named, and
dropped. Once a turn moves on, the intention is gone: nothing in the next tool result reminds you
of it, and the answer you produce is one an unassisted model would have produced.

**So: intention and action are the same step.** "Let me load X" and the `read_file` of X are one
move with nothing between them. If you find yourself writing *"first let me…"* after naming a bit,
that sentence is the bug — delete it and read the file.

---

## When a bit will not load

A `read_file` on a bit can fail for four different reasons, and they need four different answers.
The tool result tells you which one — read it before you decide what to say.

| The result says | What it means | What you do |
|---|---|---|
| **EXISTS … cannot open it yet** | The bit is published. This developer's account is not entitled to it. | Say so, and offer the account. **Keep working.** |
| **IS in the registry catalog, but fetching … failed** | A network blip. | Retry the same read **once**. |
| **path auto-corrected** | You mis-derived the directory. | Nothing — the right bit was served. Use the corrected path from now on. |
| **not found … not locked** | No bit with that id exists. | Say the workflow is unavailable and stop. Do not improvise it. |

### A locked bit is not a missing bit

This is the one that goes wrong. Some bits are gated on an entitlement, and a developer without it
sees the bit withheld — **the bit is fine and there is nothing broken.**

**Never tell a developer to publish a bit, or to set `ADSUM_KBIT_LOCAL` or any other environment
variable.** Those are Adsum's own maintenance actions, not theirs. Offering them reads as "the
product is broken, please go repair our registry". On 2026-09-10 a guided gateway build did exactly
this: five gated bits were reported as not existing, and the developer was invited to publish them
to Adsum's registry. They only needed a free account, which was never mentioned.

**What to say instead**, and the tool result gives you the wording for the case at hand:

- **A free account opens it** — cellular, edge-AI and the demo images. Say it is free, no card, and
  that Register in the Adsum panel (or Settings → Account) takes about a minute.
- **It is granted per developer** — template source and production images. Say access is by request
  from Settings → Account. Registering alone will not open it, so do not imply it will.

### Then carry on

A locked bit is not the end of the task. Do the parts you **can** do, and say plainly:

- which bit you went without, by name
- what that costs — what is now unverified, guessed, or skipped

What you must **not** do is fill the gap from memory or from a previous report. That is the same
anti-improvisation rule as a missing bit: a beat you cannot read is a beat you cannot perform, and a
confident answer built on no source is worse for the developer than an honest gap.

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
3. **A Workflow tells you to load an Action via a `MANDATORY BIT LOAD` directive** — obey the directive.
4. **The user asks a question that matches no operation in the platform's table** (e.g. "explain what this config option does") — no Workflow load needed → answer from your knowledge with the `AGENT.md` Scope Gate applied.
5. **You're deep in a scaffold Workflow and the code is ready to build** — the Command Gate fires in sequence: build → flash → capture → analyze. Skipping any of these because "the Workflow is already loaded" is the failure this gate exists to prevent.

See the platform stub (`platforms/<platform>/rules/bit-loading.md`) for the concrete Operation →
Workflow table, Command Gate table, and platform-specific worked examples.
