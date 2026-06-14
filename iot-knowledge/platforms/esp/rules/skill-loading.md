# ESP Platform Rule: Skill Loading (rules/skill-loading.md)

This rule governs when and how you load Workflows and Actions from the `iot-knowledge` library.

## The Operation-Gating Principle (read this first)

**Before you perform any complex ESP operation, you MUST first `read_file` the Workflow that covers it.**

This fires whenever you are *about to act*, however you got there:
- The user asked for the operation, OR you decided to do it from your own analysis, OR another Workflow handed off to it, OR the conversation moved on and the next request needs it again.

You may NOT execute a complex operation from pre-trained knowledge — the ESP-IDF API and idf.py surface change between versions, and the Workflow is the source of truth for the steps, permission gates, error handling and Action chain. "Loading" a Workflow is simply `read_file` on its markdown; there is no separate load tool.

## Operation → Workflow

This table is organized by what you, the agent, are about to *do* — not by what the user typed.

| About to do (the operation) | Workflow to load first |
|---|---|
| **Scaffold a new ESP-IDF prototype** — task contains `scaffold a new ESP-IDF prototype` or `Start a new ESP-IDF prototype` | `platforms/esp/workflows/prototype.md` |
| **Add a feature to an existing project** — task contains `add a feature` or `Add a feature to` | `platforms/esp/workflows/add-feature.md` |
| **Test or validate firmware** — task contains `test and validate` or `Prove` + `works` | `platforms/esp/workflows/test-validate.md` |
| Build firmware · Flash firmware · run the Build → Flash → Capture → Analyze → Fix cycle · diagnose a crash/panic/WDT/brownout | `platforms/esp/workflows/debug-loop.md` |
| Capture serial logs · analyze logs · diagnose runtime behaviour on a board **already running** (no reflash) | `platforms/esp/workflows/log-analyzer.md` |
| Add `ESP_LOG*` instrumentation to existing source · prepare a project for future log capture | `platforms/esp/workflows/log-generator.md` |

If an upcoming operation matches no row, you are not in a Workflow's scope — answer from knowledge with the `AGENT.md` Scope Gate applied.

## Workflows vs Actions (Hierarchy)
- **Workflows** are the **only** valid entry points. You load them via this rule.
- **Actions** (`platforms/esp/actions/*.md`) are atomic subroutines invoked *by an active Workflow* through a `MANDATORY SKILL LOAD` directive. You are **STRICTLY FORBIDDEN** from loading an Action as the first read of a task — **except when the Command Gate below fires**.

## The Command Gate (HARD RULE — fires at the moment of execution)
The table above fires on *intent*. This gate fires on the *act*: the instant you are about to issue one of these commands, the matching Action file MUST already be in your context. If it is not, **STOP and `read_file` it first** — regardless of which Workflow you are in or how confident you feel.

| About to do (any phrasing, any entry path) | Action file that MUST be in context |
|---|---|
| `idf.py build` (any variant) | `platforms/esp/actions/build.md` |
| `idf.py flash` / any flashing | `platforms/esp/actions/flash.md` |
| Capture serial logs (`action="monitor"`) | `platforms/esp/actions/capture-logs.md` |
| Open / read / interpret a captured log under `logs/` | `platforms/esp/actions/analyze-logs.md` |
| A panic / `Guru Meditation` backtrace appears in a log | `platforms/esp/actions/decode-fault.md` |
| Change a Kconfig value (`sdkconfig` / `sdkconfig.defaults`) | `platforms/esp/actions/configure.md` |
| Run Unity tests (host `linux` / QEMU / on-hardware pytest) | `platforms/esp/actions/run-tests.md` |
| Pick an IDF example / registry component to copy or pull from | `platforms/esp/actions/find-sample.md` |
| Create/edit a CI workflow for firmware build/tests | `platforms/esp/actions/setup-ci.md` |

**Why this is non-negotiable:** these files carry hardware-verified rules you cannot derive from general knowledge — target reconciliation, the `sdkconfig` vs `sdkconfig.defaults` trap, the always-pass-the-port rule, monitor's backtrace decode, the Xtensa-vs-RISC-V `addr2line` prefix, the `linux`/QEMU tier split. Running these by trial-and-error is the #1 documented field failure. One `read_file` is cheaper than a failed flash or a misleading capture.

**Capture without analysis is an unfinished operation.** After any log capture, the analyze step is part of the same operation — never end at "logs captured".

## Load-Once Optimization
If a Workflow or Action file is already in your current context (you read it earlier this task, e.g. on a previous debug-loop iteration), **do NOT read it again** — rely on what's already in context. Re-read only if it was truncated/compacted or you need to re-verify exact steps. Files listed under "Knowledge Already Loaded" in your system context are already present — never re-read those.

## Worked Examples
1. **Fresh chat: "flash my code to the esp32-s3"** → about to flash → read `workflows/debug-loop.md`.
2. **"build me a wifi sensor dashboard from scratch"** → about to scaffold a prototype → read `workflows/prototype.md`.
3. **Mid-analysis you find the firmware was never flashed** → about to flash → read `workflows/debug-loop.md`.
4. **Inside debug-loop, it says load `actions/build.md` via MANDATORY SKILL LOAD** → obey the directive.
5. **"what does CONFIG_FREERTOS_HZ do?"** → matches no operation → answer directly, Scope Gate applied.
6. **You're deep in `prototype.md` and the scaffold is ready to build** — the Command Gate fires in sequence: `build.md` before `idf.py build`, `flash.md` before flashing, `capture-logs.md` before capturing, `analyze-logs.md` before reading the captured file. Skipping any because "the prototype workflow is already loaded" is the failure this gate exists to prevent.
